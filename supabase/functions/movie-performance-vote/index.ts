import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTOR_CACHE_TTL_MS = 30 * 60 * 1000;
const actorIdCache = new Map<string, { at: number; ids: Set<number> }>();

type VoteBody = {
  action?: string;
  movieTraktId?: number;
  personTraktId?: number;
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseMovieVoteRequestBody(body: VoteBody) {
  const action = body?.action === 'clear' ? 'clear' : body?.action === 'cast' ? 'cast' : null;
  const movieTraktId = Number(body?.movieTraktId);
  const personTraktId = body?.personTraktId == null ? null : Number(body.personTraktId);
  const validIds = Number.isInteger(movieTraktId) && movieTraktId > 0;
  if (!action || !validIds) {
    return { ok: false as const, error: 'invalid_request' };
  }
  if (action === 'cast' && (!Number.isInteger(personTraktId) || (personTraktId ?? 0) <= 0)) {
    return { ok: false as const, error: 'invalid_person' };
  }
  return {
    ok: true as const,
    action,
    movieTraktId,
    personTraktId: action === 'cast' ? personTraktId : null,
  };
}

function extractMovieActorIds(peoplePayload: {
  cast?: Array<{ person?: { ids?: { trakt?: number } } }>;
}) {
  const ids = new Set<number>();
  (peoplePayload?.cast || []).forEach((entry) => {
    const traktId = Number(entry?.person?.ids?.trakt);
    if (Number.isInteger(traktId) && traktId > 0) {
      ids.add(traktId);
    }
  });
  return ids;
}

function getCachedActorIds(movieTraktId: number) {
  const key = String(movieTraktId);
  const hit = actorIdCache.get(key);
  if (!hit || Date.now() - hit.at > ACTOR_CACHE_TTL_MS) {
    return null;
  }
  return hit.ids;
}

function setCachedActorIds(movieTraktId: number, ids: Set<number>) {
  actorIdCache.set(String(movieTraktId), { at: Date.now(), ids });
}

async function fetchMovieActorIds(movieTraktId: number) {
  const cached = getCachedActorIds(movieTraktId);
  if (cached) {
    return { ids: cached, cache: 'hit' as const };
  }

  const clientId = Deno.env.get('TRAKT_CLIENT_ID')?.trim();
  if (!clientId) {
    throw new Error('trakt_config');
  }
  const path = `https://api.trakt.tv/movies/${encodeURIComponent(String(movieTraktId))}/people`;
  const response = await fetch(path, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'User-Agent': 'Seenzo/1.0.0',
    },
  });
  if (!response.ok) {
    throw new Error(`trakt_${response.status}`);
  }
  const people = await response.json();
  const ids = extractMovieActorIds(people);
  setCachedActorIds(movieTraktId, ids);
  return { ids, cache: 'miss' as const };
}

function withTiming(timings: Record<string, number>, label: string, started: number) {
  timings[label] = Date.now() - started;
}

Deno.serve(async (req) => {
  const timings: Record<string, number> = {};
  const requestStarted = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: 'server_config' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json(401, { error: 'unauthenticated' });
  }

  const authStarted = Date.now();
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  withTiming(timings, 'auth_ms', authStarted);
  if (userError || !user?.id) {
    return json(401, { error: 'unauthenticated', timings });
  }

  let body: VoteBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const parsed = parseMovieVoteRequestBody(body);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const movieMediaId = `trakt-movie-${parsed.movieTraktId}`;
  let myPersonId: number | null = null;

  if (parsed.action === 'cast') {
    const validateStarted = Date.now();
    const watchedPromise = admin
      .from('media_entries')
      .select('movie_watched')
      .eq('user_id', user.id)
      .eq('media_id', movieMediaId)
      .eq('media_type', 'movie')
      .eq('movie_watched', true)
      .maybeSingle();
    const actorsPromise = fetchMovieActorIds(parsed.movieTraktId);

    const [watchedResult, actorsResult] = await Promise.all([
      watchedPromise,
      actorsPromise.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
    ]);
    withTiming(timings, 'validate_ms', validateStarted);

    if (watchedResult.error) {
      return json(500, { error: 'watched_lookup_failed', timings });
    }
    if (!watchedResult.data) {
      return json(403, { error: 'movie_not_watched', timings });
    }
    if (!actorsResult.ok) {
      return json(502, { error: 'trakt_unavailable', timings });
    }

    timings.trakt_cache = actorsResult.value.cache === 'hit' ? 1 : 0;
    if (!actorsResult.value.ids.has(parsed.personTraktId as number)) {
      return json(403, { error: 'actor_not_in_movie', timings });
    }

    const writeStarted = Date.now();
    const { error: upsertError } = await admin.from('movie_performance_votes').upsert(
      {
        user_id: user.id,
        movie_trakt_id: parsed.movieTraktId,
        person_trakt_id: parsed.personTraktId,
      },
      { onConflict: 'user_id,movie_trakt_id' },
    );
    withTiming(timings, 'write_ms', writeStarted);
    if (upsertError) {
      return json(500, { error: 'vote_save_failed', timings });
    }
    myPersonId = parsed.personTraktId as number;
  } else {
    const writeStarted = Date.now();
    const { error: deleteError } = await admin
      .from('movie_performance_votes')
      .delete()
      .eq('user_id', user.id)
      .eq('movie_trakt_id', parsed.movieTraktId);
    withTiming(timings, 'write_ms', writeStarted);
    if (deleteError) {
      return json(500, { error: 'vote_clear_failed', timings });
    }
    myPersonId = null;
  }

  const statsStarted = Date.now();
  const { data: stats, error: statsError } = await admin.rpc('movie_performance_vote_stats', {
    p_movie_trakt_id: parsed.movieTraktId,
  });
  withTiming(timings, 'stats_ms', statsStarted);
  if (statsError) {
    return json(500, { error: 'stats_failed', timings });
  }

  const rows = (stats || []).map((row: {
    person_trakt_id: number | null;
    vote_count: number;
    total_votes: number;
    my_person_trakt_id: number | null;
  }) => ({
    ...row,
    my_person_trakt_id: myPersonId,
  }));

  timings.total_ms = Date.now() - requestStarted;
  return json(200, { ok: true, stats: rows, timings });
});
