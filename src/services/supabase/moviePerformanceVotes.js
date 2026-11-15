import { getSupabase } from './client';
import {
  emptyVoteStats,
  isVotesSetupUnavailable,
  normalizeVoteStats,
  rankPerformanceVotes,
} from './performanceVotes';

export { emptyVoteStats, isVotesSetupUnavailable, normalizeVoteStats, rankPerformanceVotes };

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

export function isMovieVotesSetupUnavailable(error) {
  if (isVotesSetupUnavailable(error)) {
    return true;
  }
  if (!error) {
    return false;
  }
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''} ${error.context || ''}`;
  return (/movie_performance_votes/i.test(message) && /does not exist|not find/i.test(message))
    || (/movie_performance_vote_stats/i.test(message) && /not find|does not exist/i.test(message))
    || (/movie-performance-vote/i.test(message) && /not found|404/i.test(message));
}

export async function fetchMoviePerformanceVoteStats(movieTraktId) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markUnavailable(new Error('config'));
  }
  const { data, error } = await supabase.rpc('movie_performance_vote_stats', {
    p_movie_trakt_id: Number(movieTraktId),
  });
  if (error) {
    throw isMovieVotesSetupUnavailable(error) ? markUnavailable(error) : error;
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

async function invokeMoviePerformanceVote(body) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markUnavailable(new Error('config'));
  }
  const { data, error } = await supabase.functions.invoke('movie-performance-vote', { body });
  const coded = await readInvokeErrorCode(data, error);
  if (coded) {
    if (coded === 'unauthenticated') {
      throw markCoded('auth', data || error);
    }
    if (coded === 'movie_not_watched' || coded === 'actor_not_in_movie') {
      throw markCoded(coded, data || error);
    }
    throw markCoded(coded, data || error);
  }
  if (error) {
    throw isMovieVotesSetupUnavailable(error) ? markUnavailable(error) : error;
  }
  return normalizeVoteStats(data?.stats || []);
}

export async function castMoviePerformanceVote({ movieTraktId, personTraktId }) {
  return invokeMoviePerformanceVote({
    action: 'cast',
    movieTraktId: Number(movieTraktId),
    personTraktId: Number(personTraktId),
  });
}

export async function clearMoviePerformanceVote({ movieTraktId }) {
  return invokeMoviePerformanceVote({
    action: 'clear',
    movieTraktId: Number(movieTraktId),
  });
}
