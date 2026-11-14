import { traktGet } from './client';
import { movieFromSearch, seasonNeedsEpisodeFetch, showFromSearch, toAppMovie, toAppShow } from './normalize';

const PAGE_SIZE = 20;
const memory = new Map();
const hydratingShows = new Map();
const hydratingMovies = new Map();
const TRENDING_TTL_MS = 10 * 60 * 1000;

function rememberList(key, value) {
  memory.set(key, { at: Date.now(), value });
  return value;
}

function readList(key) {
  const hit = memory.get(key);
  if (!hit || Date.now() - hit.at > TRENDING_TTL_MS) {
    return null;
  }
  return hit.value;
}

async function pageOf(path, query, mapItem) {
  const result = await traktGet(path, { ...query, extended: 'full', limit: PAGE_SIZE });
  const items = Array.isArray(result.data) ? result.data.map(mapItem).filter(Boolean) : [];
  return {
    items,
    page: result.page || Number(query.page) || 1,
    pageCount: result.pageCount || 1,
  };
}

export function searchShowsPage(query, page = 1) {
  return pageOf('/search/show', { query, page }, showFromSearch);
}

export function searchMoviesPage(query, page = 1) {
  return pageOf('/search/movie', { query, page }, movieFromSearch);
}

export async function trendingShowsPage(page = 1) {
  const key = `shows-trending:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/shows/trending', { page }, showFromSearch);
  return rememberList(key, result);
}

export async function trendingMoviesPage(page = 1) {
  const key = `movies-trending:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/movies/trending', { page }, movieFromSearch);
  return rememberList(key, result);
}

async function hydrateShowNow(traktId) {
  const summary = await traktGet(`/shows/${encodeURIComponent(traktId)}`, { extended: 'full' });
  const seasonResult = await traktGet(`/shows/${encodeURIComponent(traktId)}/seasons`, { extended: 'full' });
  const seasons = Array.isArray(seasonResult.data) ? seasonResult.data : [];
  const filled = [];
  for (const season of seasons) {
    if (!seasonNeedsEpisodeFetch(season)) {
      if (typeof season?.number === 'number') {
        filled.push(season);
      }
      continue;
    }
    try {
      const episodeResult = await traktGet(
        `/shows/${encodeURIComponent(traktId)}/seasons/${season.number}`,
        { extended: 'full' }
      );
      filled.push({
        ...season,
        episodes: Array.isArray(episodeResult.data) ? episodeResult.data : [],
      });
    } catch (error) {
      if (error?.code === 'forbidden' || error?.code === 'unauthorized') {
        throw error;
      }
      filled.push({ ...season, episodes: [] });
    }
  }
  return toAppShow(summary.data, filled, true);
}

export function hydrateShow(traktId) {
  const key = String(traktId);
  const pending = hydratingShows.get(key);
  if (pending) {
    return pending;
  }
  const task = hydrateShowNow(key).finally(() => hydratingShows.delete(key));
  hydratingShows.set(key, task);
  return task;
}

export function hydrateMovie(traktId) {
  const key = String(traktId);
  const pending = hydratingMovies.get(key);
  if (pending) {
    return pending;
  }
  const task = traktGet(`/movies/${encodeURIComponent(key)}`, { extended: 'full' })
    .then((summary) => toAppMovie(summary.data))
    .finally(() => hydratingMovies.delete(key));
  hydratingMovies.set(key, task);
  return task;
}
