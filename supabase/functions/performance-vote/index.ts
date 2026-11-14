import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type VoteBody = {
  action?: string;
  showTraktId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  personTraktId?: number;
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseVoteRequestBody(body: VoteBody) {
  const action = body?.action === 'clear' ? 'clear' : body?.action === 'cast' ? 'cast' : null;
  const showTraktId = Number(body?.showTraktId);
  const seasonNumber = Number(body?.seasonNumber);
  const episodeNumber = Number(body?.episodeNumber);
  const personTraktId = body?.personTraktId == null ? null : Number(body.personTraktId);
  const validIds = Number.isInteger(showTraktId)
    && showTraktId > 0
    && Number.isInteger(seasonNumber)
    && seasonNumber >= 0
    && Number.isInteger(episodeNumber)
    && episodeNumber >= 1;
  if (!action || !validIds) {
    return { ok: false as const, error: 'invalid_request' };
  }
  if (action === 'cast' && (!Number.isInteger(personTraktId) || (personTraktId ?? 0) <= 0)) {
    return { ok: false as const, error: 'invalid_person' };
  }
  return {
    ok: true as const,
    action,
    showTraktId,
    seasonNumber,
    episodeNumber,
    personTraktId: action === 'cast' ? personTraktId : null,
  };
}

function extractEpisodeActorIds(peoplePayload: {
  cast?: Array<{ person?: { ids?: { trakt?: number } } }>;
  guest_stars?: Array<{ person?: { ids?: { trakt?: number } } }>;
}) {
  const ids = new Set<number>();
  const push = (entry: { person?: { ids?: { trakt?: number } } } | undefined) => {
    const traktId = Number(entry?.person?.ids?.trakt);
    if (Number.isInteger(traktId) && traktId > 0) {
      ids.add(traktId);
    }
  };
  (peoplePayload?.cast || []).forEach(push);
  (peoplePayload?.guest_stars || []).forEach(push);
  return ids;
}

async function fetchEpisodePeople(showTraktId: number, seasonNumber: number, episodeNumber: number) {
  const clientId = Deno.env.get('TRAKT_CLIENT_ID')?.trim();
  if (!clientId) {
    throw new Error('trakt_config');
  }
  const path = `https://api.trakt.tv/shows/${encodeURIComponent(String(showTraktId))}/seasons/${seasonNumber}/episodes/${episodeNumber}/people?extended=full,guest_stars`;
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
  return response.json();
}

Deno.serve(async (req) => {
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

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user?.id) {
    return json(401, { error: 'unauthenticated' });
  }

  let body: VoteBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const parsed = parseVoteRequestBody(body);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const showMediaId = `trakt-show-${parsed.showTraktId}`;

  if (parsed.action === 'cast') {
    const { data: episodeRow, error: episodeError } = await admin
      .from('episode_entries')
      .select('watched')
      .eq('user_id', user.id)
      .eq('show_media_id', showMediaId)
      .eq('season_number', parsed.seasonNumber)
      .eq('episode_number', parsed.episodeNumber)
      .eq('watched', true)
      .maybeSingle();

    if (episodeError) {
      return json(500, { error: 'watched_lookup_failed' });
    }
    if (!episodeRow) {
      return json(403, { error: 'episode_not_watched' });
    }

    let people;
    try {
      people = await fetchEpisodePeople(parsed.showTraktId, parsed.seasonNumber, parsed.episodeNumber);
    } catch {
      return json(502, { error: 'trakt_unavailable' });
    }

    const eligible = extractEpisodeActorIds(people);
    if (!eligible.has(parsed.personTraktId as number)) {
      return json(403, { error: 'actor_not_in_episode' });
    }

    const { error: upsertError } = await admin.from('performance_votes').upsert(
      {
        user_id: user.id,
        show_trakt_id: parsed.showTraktId,
        season_number: parsed.seasonNumber,
        episode_number: parsed.episodeNumber,
        person_trakt_id: parsed.personTraktId,
      },
      { onConflict: 'user_id,show_trakt_id,season_number,episode_number' },
    );
    if (upsertError) {
      return json(500, { error: 'vote_save_failed' });
    }
  } else {
    const { error: deleteError } = await admin
      .from('performance_votes')
      .delete()
      .eq('user_id', user.id)
      .eq('show_trakt_id', parsed.showTraktId)
      .eq('season_number', parsed.seasonNumber)
      .eq('episode_number', parsed.episodeNumber);
    if (deleteError) {
      return json(500, { error: 'vote_clear_failed' });
    }
  }

  const { data: stats, error: statsError } = await admin.rpc('performance_vote_stats', {
    p_show_trakt_id: parsed.showTraktId,
    p_season_number: parsed.seasonNumber,
    p_episode_number: parsed.episodeNumber,
  });
  if (statsError) {
    return json(500, { error: 'stats_failed' });
  }

  // Re-scope my vote using the caller's identity (service role RPC sees null auth.uid()).
  const { data: mine } = await admin
    .from('performance_votes')
    .select('person_trakt_id')
    .eq('user_id', user.id)
    .eq('show_trakt_id', parsed.showTraktId)
    .eq('season_number', parsed.seasonNumber)
    .eq('episode_number', parsed.episodeNumber)
    .maybeSingle();

  const myPersonId = mine?.person_trakt_id ?? null;
  const rows = (stats || []).map((row: {
    person_trakt_id: number | null;
    vote_count: number;
    total_votes: number;
    my_person_trakt_id: number | null;
  }) => ({
    ...row,
    my_person_trakt_id: myPersonId,
  }));

  return json(200, { ok: true, stats: rows });
});
