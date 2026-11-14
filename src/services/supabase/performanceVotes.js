import { getSupabase } from './client';

export function emptyVoteStats() {
  return {
    totalVotes: 0,
    myPersonId: null,
    counts: {},
  };
}

export function isVotesSetupUnavailable(error) {
  if (!error) {
    return false;
  }
  if (error.code === 'votes_unavailable' || error.code === 'config') {
    return true;
  }
  const code = String(error.code || '');
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''} ${error.context || ''}`;
  return code === 'PGRST202'
    || code === 'PGRST205'
    || code === '42P01'
    || /Could not find the (function|table)/i.test(message)
    || /schema cache/i.test(message)
    || /Function not found/i.test(message)
    || /Failed to send a request to the Edge Function/i.test(message)
    || (/performance_votes/i.test(message) && /does not exist|not find/i.test(message))
    || (/performance_vote_stats/i.test(message) && /not find|does not exist/i.test(message))
    || (/performance-vote/i.test(message) && /not found|404/i.test(message));
}

function markUnavailable(error) {
  const failure = new Error('votes_unavailable');
  failure.code = 'votes_unavailable';
  failure.cause = error;
  return failure;
}

function markCoded(code, cause) {
  const failure = new Error(code);
  failure.code = code;
  failure.cause = cause;
  return failure;
}

export function normalizeVoteStats(rows) {
  const counts = {};
  let totalVotes = 0;
  let myPersonId = null;
  (rows || []).forEach((row) => {
    if (row.my_person_trakt_id != null) {
      myPersonId = Number(row.my_person_trakt_id);
    }
    const rowTotal = Number(row.total_votes);
    if (Number.isFinite(rowTotal) && rowTotal > totalVotes) {
      totalVotes = rowTotal;
    }
    const personId = Number(row.person_trakt_id);
    const voteCount = Number(row.vote_count) || 0;
    if (!Number.isInteger(personId) || personId <= 0) {
      return;
    }
    counts[personId] = voteCount;
  });
  if (!totalVotes) {
    totalVotes = Object.values(counts).reduce((sum, value) => sum + value, 0);
  }
  return { totalVotes, myPersonId, counts };
}

export function rankPerformanceVotes(people, stats) {
  const list = Array.isArray(people) ? people : [];
  const counts = stats?.counts || {};
  const totalVotes = Number(stats?.totalVotes) || 0;
  return list
    .map((person) => {
      const voteCount = Number(counts[person.personId]) || 0;
      const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
      return {
        ...person,
        voteCount,
        percent,
        selected: stats?.myPersonId === person.personId,
      };
    })
    .sort((left, right) => {
      if (right.voteCount !== left.voteCount) {
        return right.voteCount - left.voteCount;
      }
      return left.name.localeCompare(right.name);
    });
}

export async function fetchPerformanceVoteStats(showTraktId, seasonNumber, episodeNumber) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markUnavailable(new Error('config'));
  }
  const { data, error } = await supabase.rpc('performance_vote_stats', {
    p_show_trakt_id: Number(showTraktId),
    p_season_number: Number(seasonNumber),
    p_episode_number: Number(episodeNumber),
  });
  if (error) {
    throw isVotesSetupUnavailable(error) ? markUnavailable(error) : error;
  }
  return normalizeVoteStats(data);
}

async function readInvokeErrorCode(data, error) {
  if (data?.error) {
    return String(data.error);
  }
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) {
        return String(body.error);
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function invokePerformanceVote(body) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markUnavailable(new Error('config'));
  }
  const { data, error } = await supabase.functions.invoke('performance-vote', { body });
  const coded = await readInvokeErrorCode(data, error);
  if (coded) {
    if (coded === 'unauthenticated') {
      throw markCoded('auth', data || error);
    }
    if (coded === 'episode_not_watched' || coded === 'actor_not_in_episode') {
      throw markCoded(coded, data || error);
    }
    throw markCoded(coded, data || error);
  }
  if (error) {
    throw isVotesSetupUnavailable(error) ? markUnavailable(error) : error;
  }
  return normalizeVoteStats(data?.stats || []);
}

export async function castPerformanceVote({
  showTraktId,
  seasonNumber,
  episodeNumber,
  personTraktId,
}) {
  return invokePerformanceVote({
    action: 'cast',
    showTraktId: Number(showTraktId),
    seasonNumber: Number(seasonNumber),
    episodeNumber: Number(episodeNumber),
    personTraktId: Number(personTraktId),
  });
}

export async function clearPerformanceVote({
  showTraktId,
  seasonNumber,
  episodeNumber,
}) {
  return invokePerformanceVote({
    action: 'clear',
    showTraktId: Number(showTraktId),
    seasonNumber: Number(seasonNumber),
    episodeNumber: Number(episodeNumber),
  });
}
