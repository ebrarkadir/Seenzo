import { getTraktConfigStatus } from './config';

export const TRAKT_API_BASE = 'https://api.trakt.tv';
export const TRAKT_API_VERSION = '2';
const REQUEST_TIMEOUT_MS = 12000;

export class TraktRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TraktRequestError';
    this.code = code;
    this.status = details.status ?? null;
    this.retryAfter = details.retryAfter ?? null;
  }
}

export function buildTraktUrl(path, query) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const params = Object.entries(query || {})
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${TRAKT_API_BASE}${suffix}${params ? `?${params}` : ''}`;
}

export function summarizeImages(images) {
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    return null;
  }
  const summary = {};
  Object.keys(images).forEach((key) => {
    const value = images[key];
    if (Array.isArray(value)) {
      summary[key] = value.length;
    } else if (value && typeof value === 'object') {
      summary[key] = Object.keys(value).length;
    }
  });
  return summary;
}

export function mapMedia(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  return {
    id: item.ids?.trakt ?? item.ids?.slug ?? null,
    title: item.title ?? null,
    year: item.year ?? null,
    overview: item.overview ?? null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    votes: typeof item.votes === 'number' ? item.votes : null,
    status: item.status ?? null,
    released: item.released ?? item.first_aired ?? null,
    runtime: item.runtime ?? null,
    network: item.network ?? null,
    genres: Array.isArray(item.genres) ? item.genres : [],
    ids: item.ids && typeof item.ids === 'object' ? item.ids : null,
    images: summarizeImages(item.images),
  };
}

function mapSearchItem(entry, type) {
  const media = mapMedia(entry?.[type]);
  if (!media?.id) {
    return null;
  }
  return { ...media, score: entry.score ?? null };
}

function mapTrendingItem(entry, type) {
  const media = mapMedia(entry?.[type]);
  if (!media?.id) {
    return null;
  }
  return { ...media, watchers: entry.watchers ?? null };
}

export function mapSeason(season) {
  if (!season || typeof season !== 'object' || typeof season.number !== 'number') {
    return null;
  }
  return {
    number: season.number,
    title: season.title ?? null,
    episodeCount: season.episode_count ?? season.aired_episodes ?? null,
    rating: typeof season.rating === 'number' ? season.rating : null,
    firstAired: season.first_aired ?? null,
    overview: season.overview ?? null,
    ids: season.ids && typeof season.ids === 'object' ? season.ids : null,
    images: summarizeImages(season.images),
  };
}

export function mapEpisode(episode) {
  if (!episode || typeof episode !== 'object' || typeof episode.number !== 'number') {
    return null;
  }
  return {
    season: episode.season ?? null,
    number: episode.number,
    title: episode.title ?? null,
    overview: episode.overview ?? null,
    rating: typeof episode.rating === 'number' ? episode.rating : null,
    firstAired: episode.first_aired ?? null,
    runtime: episode.runtime ?? null,
    ids: episode.ids && typeof episode.ids === 'object' ? episode.ids : null,
    images: summarizeImages(episode.images),
  };
}

function retryAfterSeconds(header) {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}

function httpError(status, retryAfter) {
  if (status === 401) {
    return new TraktRequestError('unauthorized', 'Trakt rejected the client id.', { status });
  }
  if (status === 403) {
    return new TraktRequestError('forbidden', 'Trakt refused this request.', { status });
  }
  if (status === 404) {
    return new TraktRequestError('notFound', 'Trakt could not find this item.', { status });
  }
  if (status === 429) {
    return new TraktRequestError('rateLimit', 'Trakt rate limit reached.', { status, retryAfter });
  }
  return new TraktRequestError('http', `Trakt request failed with status ${status}.`, { status });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestOnce(path, query) {
  const config = getTraktConfigStatus();
  if (!config.ready) {
    throw new TraktRequestError(config.reason, 'Trakt client id is not configured.');
  }

  const clientId = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildTraktUrl(path, query), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Seenzo/1.0.0',
        'trakt-api-key': clientId,
        'trakt-api-version': TRAKT_API_VERSION,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    let data = null;
    if (body) {
      try {
        data = JSON.parse(body);
      } catch {
        throw new TraktRequestError('invalid', 'Trakt returned a response that was not JSON.', {
          status: response.status,
        });
      }
    }
    if (!response.ok) {
      throw httpError(response.status, retryAfterSeconds(response.headers.get('Retry-After')));
    }
    return {
      data,
      page: Number(response.headers.get('X-Pagination-Page')) || Number(query?.page) || 1,
      pageCount: Number(response.headers.get('X-Pagination-Page-Count')) || 1,
    };
  } catch (error) {
    if (error instanceof TraktRequestError) {
      throw error;
    }
    if (error?.name === 'AbortError') {
      throw new TraktRequestError('timeout', 'The Trakt request timed out.');
    }
    throw new TraktRequestError('network', 'The Trakt request could not be completed.');
  } finally {
    clearTimeout(timer);
  }
}

async function request(path, query) {
  try {
    const result = await requestOnce(path, query);
    return result.data;
  } catch (error) {
    if (error instanceof TraktRequestError && error.code === 'rateLimit' && error.retryAfter != null && error.retryAfter <= 30) {
      await delay(error.retryAfter * 1000);
      const result = await requestOnce(path, query);
      return result.data;
    }
    throw error;
  }
}

export async function traktGet(path, query) {
  try {
    return await requestOnce(path, query);
  } catch (error) {
    if (error instanceof TraktRequestError && error.code === 'rateLimit' && error.retryAfter != null && error.retryAfter <= 30) {
      await delay(error.retryAfter * 1000);
      return requestOnce(path, query);
    }
    throw error;
  }
}

function expectList(data) {
  if (!Array.isArray(data)) {
    throw new TraktRequestError('invalid', 'Trakt returned an unexpected list.');
  }
  return data;
}

function requireId(id) {
  const value = String(id ?? '').trim();
  if (!value || value.includes('/')) {
    throw new TraktRequestError('invalid', 'A Trakt id is required.');
  }
  return encodeURIComponent(value);
}

export async function searchMovies(query) {
  const data = expectList(await request('/search/movie', { query, extended: 'full', limit: 10 }));
  return data.map((entry) => mapSearchItem(entry, 'movie')).filter(Boolean);
}

export async function searchShows(query) {
  const data = expectList(await request('/search/show', { query, extended: 'full', limit: 10 }));
  return data.map((entry) => mapSearchItem(entry, 'show')).filter(Boolean);
}

export async function trendingMovies() {
  const data = expectList(await request('/movies/trending', { extended: 'full', limit: 10 }));
  return data.map((entry) => mapTrendingItem(entry, 'movie')).filter(Boolean);
}

export async function trendingShows() {
  const data = expectList(await request('/shows/trending', { extended: 'full', limit: 10 }));
  return data.map((entry) => mapTrendingItem(entry, 'show')).filter(Boolean);
}

export async function movieDetails(id) {
  const data = await request(`/movies/${requireId(id)}`, { extended: 'full' });
  const media = mapMedia(data);
  if (!media?.title) {
    throw new TraktRequestError('invalid', 'Trakt returned an unexpected movie.');
  }
  return media;
}

export async function showDetails(id) {
  const data = await request(`/shows/${requireId(id)}`, { extended: 'full' });
  const media = mapMedia(data);
  if (!media?.title) {
    throw new TraktRequestError('invalid', 'Trakt returned an unexpected show.');
  }
  return media;
}

export async function showSeasons(id) {
  const data = expectList(await request(`/shows/${requireId(id)}/seasons`, { extended: 'full' }));
  return data.map(mapSeason).filter(Boolean);
}

export async function seasonEpisodes(id, season) {
  const seasonNumber = Number(season);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    throw new TraktRequestError('invalid', 'A season number is required.');
  }
  const data = expectList(
    await request(`/shows/${requireId(id)}/seasons/${seasonNumber}`, { extended: 'full' })
  );
  return data.map(mapEpisode).filter(Boolean);
}
