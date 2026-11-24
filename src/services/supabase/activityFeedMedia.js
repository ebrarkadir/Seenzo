import { rememberMovie, rememberShow, resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { hydrateMovie, hydrateShow } from '../trakt/catalog';
import {
  parseTraktMovieKey,
  parseTraktShowKey,
} from '../trakt/normalize';

const metaCache = new Map();
const inflight = new Map();

function cacheKey(kind, id) {
  return `${kind}:${id || ''}`;
}

function posterFromRecord(record) {
  if (!record || typeof record !== 'object') {
    return { posterPath: null, posterUri: null };
  }
  // Trakt/catalog records use posterPath; demo catalog uses poster (https URI).
  if (typeof record.posterPath === 'string' && record.posterPath.trim()) {
    return { posterPath: record.posterPath.trim(), posterUri: null };
  }
  if (typeof record.poster === 'string' && record.poster.trim()) {
    const value = record.poster.trim();
    if (value.includes('trakt.tv')) {
      return { posterPath: value.replace(/^https?:\/\//i, ''), posterUri: null };
    }
    return { posterPath: null, posterUri: value };
  }
  return { posterPath: null, posterUri: null };
}

function needsHydration(record, traktId) {
  if (!traktId) {
    return false;
  }
  if (!record) {
    return true;
  }
  const art = posterFromRecord(record);
  return !art.posterPath && !art.posterUri;
}

function moviePresentation(movie, mediaId) {
  const art = posterFromRecord(movie);
  return {
    title: movie?.title || mediaId,
    meta: movie?.year != null ? String(movie.year) : null,
    posterPath: art.posterPath,
    posterUri: art.posterUri,
    route: mediaId && parseTraktMovieKey(mediaId)
      ? `/movie/${encodeURIComponent(mediaId)}`
      : null,
  };
}

function showPresentation(show, mediaId, extraMeta = null) {
  const art = posterFromRecord(show);
  const year = show?.year != null ? String(show.year) : null;
  const meta = [extraMeta, year].filter(Boolean).join(' · ') || null;
  return {
    title: show?.title || mediaId,
    meta,
    posterPath: art.posterPath,
    posterUri: art.posterUri,
    route: mediaId && parseTraktShowKey(mediaId)
      ? `/show/${encodeURIComponent(mediaId)}`
      : null,
  };
}

function episodeCode(seasonNumber, episodeNumber) {
  if (seasonNumber == null || episodeNumber == null) {
    return null;
  }
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

/**
 * Sync presentation from the local media library only.
 * Does not depend on the viewer's watchlist — only on catalog cache / demo data.
 */
export function resolveActivityMediaSync(item) {
  if (!item) {
    return {
      title: '',
      meta: null,
      posterPath: null,
      posterUri: null,
      route: null,
      hydrateTarget: null,
    };
  }

  if (item.mediaType === 'movie' || item.activityType?.startsWith('movie_')) {
    const movie = resolveMovie(item.mediaId);
    const presentation = moviePresentation(movie, item.mediaId);
    const traktId = parseTraktMovieKey(item.mediaId);
    return {
      ...presentation,
      hydrateTarget: needsHydration(movie, traktId)
        ? { kind: 'movie', traktId, mediaId: item.mediaId }
        : null,
    };
  }

  if (item.activityType === 'show_rated' || item.mediaType === 'show') {
    const show = resolveShow(item.mediaId);
    const presentation = showPresentation(show, item.mediaId);
    const traktId = parseTraktShowKey(item.mediaId);
    return {
      ...presentation,
      hydrateTarget: needsHydration(show, traktId)
        ? { kind: 'show', traktId, mediaId: item.mediaId }
        : null,
    };
  }

  // Episodes and episode ratings: always use the parent show for artwork + route.
  // Never treat trakt-episode-* as a show id.
  const showId = item.showMediaId || null;
  const show = showId ? resolveShow(showId) : null;
  const code = episodeCode(item.seasonNumber, item.episodeNumber);
  const presentation = showPresentation(show, showId || item.mediaId, code);
  const traktId = parseTraktShowKey(showId);
  return {
    ...presentation,
    hydrateTarget: needsHydration(show, traktId)
      ? { kind: 'show', traktId, mediaId: showId }
      : null,
  };
}

/**
 * Remote Trakt hydration for feed artwork/titles.
 * Deduped and cached. Safe to call for media the viewer has never tracked.
 */
export async function hydrateActivityMedia(target) {
  if (!target?.kind || !target?.traktId) {
    return null;
  }
  const key = cacheKey(target.kind, target.traktId);
  if (metaCache.has(key)) {
    return metaCache.get(key);
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const task = (async () => {
    try {
      if (target.kind === 'movie') {
        const movie = await hydrateMovie(target.traktId);
        if (movie) {
          rememberMovie(movie);
        }
        const presentation = moviePresentation(movie, target.mediaId);
        metaCache.set(key, presentation);
        return presentation;
      }
      const show = await hydrateShow(target.traktId);
      if (show) {
        rememberShow(show);
      }
      const presentation = showPresentation(show, target.mediaId);
      metaCache.set(key, presentation);
      return presentation;
    } catch {
      metaCache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/** Test helper — clear in-memory hydration state. */
export function resetActivityMediaCache() {
  metaCache.clear();
  inflight.clear();
}
