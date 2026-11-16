import { traktGet } from './client';
import { normalizeEpisodeOverview } from './normalize';

const overviewCache = new Map();
const inflight = new Map();

export function episodeOverviewCacheKey(traktShowId, seasonNumber, episodeNumber) {
  return `${traktShowId}:${seasonNumber}:${episodeNumber}`;
}

export function readCachedEpisodeOverview(traktShowId, seasonNumber, episodeNumber) {
  const key = episodeOverviewCacheKey(traktShowId, seasonNumber, episodeNumber);
  if (!overviewCache.has(key)) {
    return null;
  }
  return overviewCache.get(key);
}

export function rememberCachedEpisodeOverview(traktShowId, seasonNumber, episodeNumber, overview) {
  const text = normalizeEpisodeOverview(overview);
  if (!text) {
    return '';
  }
  overviewCache.set(episodeOverviewCacheKey(traktShowId, seasonNumber, episodeNumber), text);
  return text;
}

/**
 * Fetch a single episode overview from Trakt.
 * Prefer local/cached values before calling this.
 */
export async function fetchEpisodeOverview(traktShowId, seasonNumber, episodeNumber) {
  const showId = String(traktShowId || '').trim();
  const season = Number(seasonNumber);
  const episode = Number(episodeNumber);
  if (!showId || !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0) {
    return '';
  }

  const cached = readCachedEpisodeOverview(showId, season, episode);
  if (cached) {
    return cached;
  }

  const key = episodeOverviewCacheKey(showId, season, episode);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const task = traktGet(
    `/shows/${encodeURIComponent(showId)}/seasons/${season}/episodes/${episode}`,
    { extended: 'full' }
  )
    .then((result) => rememberCachedEpisodeOverview(showId, season, episode, result?.data?.overview))
    .catch(() => '')
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}
