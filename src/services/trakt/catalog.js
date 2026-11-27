import { traktGet } from './client';
import { rememberCachedEpisodeOverview } from './episodes';
import { movieFromSearch, normalizeEpisodeOverview, seasonNeedsEpisodeFetch, showFromSearch, toAppMovie, toAppShow } from './normalize';
import { genreApiSlug } from '../../tracking/preferenceProfile';

const PAGE_SIZE = 20;
const RELATED_PAGE_SIZE = 10;
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

function popularShowItem(entry) {
  if (entry?.show) {
    return showFromSearch(entry);
  }
  return toAppShow(entry, [], false);
}

function popularMovieItem(entry) {
  if (entry?.movie) {
    return movieFromSearch(entry);
  }
  return toAppMovie(entry);
}

export async function popularShowsPage(page = 1) {
  const key = `shows-popular:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/shows/popular', { page }, popularShowItem);
  return rememberList(key, result);
}

export async function popularMoviesPage(page = 1) {
  const key = `movies-popular:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/movies/popular', { page }, popularMovieItem);
  return rememberList(key, result);
}

function mergeUniqueCatalogItems(pages) {
  const seen = new Set();
  const items = [];
  (pages || []).forEach((page) => {
    (page?.items || []).forEach((item) => {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      items.push(item);
    });
  });
  return items;
}

async function pageOfRelated(path, query, mapItem) {
  const result = await traktGet(path, {
    ...query,
    extended: 'full',
    limit: RELATED_PAGE_SIZE,
  });
  const items = Array.isArray(result.data) ? result.data.map(mapItem).filter(Boolean) : [];
  return {
    items,
    page: result.page || Number(query.page) || 1,
    pageCount: result.pageCount || 1,
  };
}

/** Public Trakt related endpoint — similar titles for a known id (cached). */
export async function relatedShowsPage(traktId, page = 1) {
  const id = String(traktId || '').trim();
  if (!id) {
    return { items: [], page: 1, pageCount: 1 };
  }
  const key = `shows-related:${id}:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOfRelated(
    `/shows/${encodeURIComponent(id)}/related`,
    { page },
    (entry) => toAppShow(entry, [], false)
  );
  return rememberList(key, result);
}

export async function relatedMoviesPage(traktId, page = 1) {
  const id = String(traktId || '').trim();
  if (!id) {
    return { items: [], page: 1, pageCount: 1 };
  }
  const key = `movies-related:${id}:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOfRelated(
    `/movies/${encodeURIComponent(id)}/related`,
    { page },
    (entry) => toAppMovie(entry)
  );
  return rememberList(key, result);
}

export async function popularShowsByGenrePage(genreSlug, page = 1) {
  const slug = genreApiSlug(genreSlug) || String(genreSlug || '').trim();
  if (!slug) {
    return { items: [], page: 1, pageCount: 1 };
  }
  const key = `shows-popular-genre:${slug}:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/shows/popular', { page, genres: slug }, popularShowItem);
  return rememberList(key, result);
}

export async function popularMoviesByGenrePage(genreSlug, page = 1) {
  const slug = genreApiSlug(genreSlug) || String(genreSlug || '').trim();
  if (!slug) {
    return { items: [], page: 1, pageCount: 1 };
  }
  const key = `movies-popular-genre:${slug}:${page}`;
  const cached = readList(key);
  if (cached) {
    return cached;
  }
  const result = await pageOf('/movies/popular', { page, genres: slug }, popularMovieItem);
  return rememberList(key, result);
}

/**
 * Discover candidate pool: trending + popular, plus controlled related/genre expansion
 * from the user's preference profile seeds (when provided). All list fetches are cached.
 */
export async function recommendationMoviePool({
  trendingPages = 2,
  popularPages = 2,
  profile = null,
  includeRelated = true,
  includeGenrePopular = true,
} = {}) {
  const tasks = [];
  for (let page = 1; page <= trendingPages; page += 1) {
    tasks.push(trendingMoviesPage(page));
  }
  for (let page = 1; page <= popularPages; page += 1) {
    tasks.push(popularMoviesPage(page));
  }
  if (includeRelated && profile?.ready) {
    (profile.topRatedSeeds || []).slice(0, 3).forEach((seed) => {
      if (seed?.traktId) {
        tasks.push(relatedMoviesPage(seed.traktId, 1));
      }
    });
  }
  if (includeGenrePopular && profile?.ready) {
    (profile.topPositiveGenres || []).slice(0, 2).forEach((genre) => {
      // Skip ultra-broad drama-only expansion — related + base pool already cover it.
      if (genre === 'drama') {
        return;
      }
      tasks.push(popularMoviesByGenrePage(genre, 1));
    });
  }
  const pages = await Promise.all(tasks.map((task) => (
    Promise.resolve(task).catch(() => ({ items: [] }))
  )));
  return mergeUniqueCatalogItems(pages);
}

export async function recommendationShowPool({
  trendingPages = 2,
  popularPages = 2,
  profile = null,
  includeRelated = true,
  includeGenrePopular = true,
} = {}) {
  const tasks = [];
  for (let page = 1; page <= trendingPages; page += 1) {
    tasks.push(trendingShowsPage(page));
  }
  for (let page = 1; page <= popularPages; page += 1) {
    tasks.push(popularShowsPage(page));
  }
  if (includeRelated && profile?.ready) {
    (profile.topRatedSeeds || []).slice(0, 3).forEach((seed) => {
      if (seed?.traktId) {
        tasks.push(relatedShowsPage(seed.traktId, 1));
      }
    });
  }
  if (includeGenrePopular && profile?.ready) {
    (profile.topPositiveGenres || []).slice(0, 2).forEach((genre) => {
      if (genre === 'drama') {
        return;
      }
      tasks.push(popularShowsByGenrePage(genre, 1));
    });
  }
  const pages = await Promise.all(tasks.map((task) => (
    Promise.resolve(task).catch(() => ({ items: [] }))
  )));
  return mergeUniqueCatalogItems(pages);
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
  const show = toAppShow(summary.data, filled, true);
  if (show?.traktId && Array.isArray(show.seasons)) {
    show.seasons.forEach((season) => {
      (season?.episodes || []).forEach((episode) => {
        const overview = normalizeEpisodeOverview(episode?.overview);
        if (!overview || typeof episode?.number !== 'number') {
          return;
        }
        rememberCachedEpisodeOverview(show.traktId, season.season, episode.number, overview);
      });
    });
  }
  return show;
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
