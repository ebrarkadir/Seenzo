import { formatGenreLabel, mediaGenreLine } from '../data/labels';
import { PREFERENCE_CONFIDENCE_HISTORY, PREFERENCE_CONFIDENCE_RATINGS, WATCHLIST_SORT_FOR_YOU, effectiveGenreAffinity, genrePairKey, mediaGenres, parseGenrePairKey, rankCandidates, scoreCandidate } from './preferenceProfile';
import { deriveShowStatus } from './status';
import { isMovieWatchlisted, isShowWatchlisted } from './watchlist';

/** Compact Discover rail — short preview only. */
export const DISCOVER_RECOMMEND_RAIL_LIMIT = 8;
/** Full See All list — all ranked candidates from the loaded pool. */
export const DISCOVER_RECOMMEND_SEE_ALL_LIMIT = Number.POSITIVE_INFINITY;
/** @deprecated Use DISCOVER_RECOMMEND_RAIL_LIMIT */
export const DISCOVER_RECOMMEND_LIMIT = DISCOVER_RECOMMEND_RAIL_LIMIT;
/** Affinity must be clearly positive before we claim a “because you like” reason. */
export const RECOMMEND_REASON_MIN_AFFINITY = 0.12;
/** Pair affinity threshold for combo copy (Crime Dramas). */
export const RECOMMEND_REASON_MIN_PAIR = 0.35;

export function isMovieExcludedFromDiscover(movieId, moviesState) {
  const entry = moviesState?.[movieId];
  return Boolean(entry?.watched);
}

export function isShowExcludedFromDiscover(showId, showsState, resolveShow) {
  const entry = showsState?.[showId];
  if (!entry) {
    return false;
  }
  const show = typeof resolveShow === 'function' ? resolveShow(showId) : null;
  if (!show) {
    return false;
  }
  const status = deriveShowStatus(show, entry);
  return status === 'completed' || status === 'caughtUp';
}

/**
 * Prefer a positively learned genre pair on the candidate; else best specificity-weighted genre.
 * History-only profiles stay honest: no strong “because you like” genre claims.
 * Returns { type: 'pair'|'genre'|'history', key } or null — never invents thematic similarity.
 */
export function recommendationReasonDescriptor(media, profile) {
  if (!profile?.ready) {
    return null;
  }
  if (profile.confidence === PREFERENCE_CONFIDENCE_HISTORY) {
    return { type: 'history', key: 'watching_history' };
  }
  if (profile.confidence && profile.confidence !== PREFERENCE_CONFIDENCE_RATINGS) {
    return null;
  }
  const genres = mediaGenres(media);
  if (!genres.length) {
    return null;
  }

  let bestPair = null;
  let bestPairScore = 0;
  for (let i = 0; i < genres.length; i += 1) {
    for (let j = i + 1; j < genres.length; j += 1) {
      const pair = genrePairKey(genres[i], genres[j]);
      if (!pair) {
        continue;
      }
      const pairScore = Number(profile.pairAffinity?.[pair]) || 0;
      if (pairScore > bestPairScore) {
        bestPairScore = pairScore;
        bestPair = pair;
      }
    }
  }
  if (bestPair && bestPairScore >= RECOMMEND_REASON_MIN_PAIR) {
    return { type: 'pair', key: bestPair };
  }

  let bestGenre = null;
  let bestAffinity = 0;
  genres.forEach((genre) => {
    const affinity = effectiveGenreAffinity(genre, profile);
    if (affinity > bestAffinity) {
      bestAffinity = affinity;
      bestGenre = genre;
    }
  });
  if (!bestGenre || bestAffinity < RECOMMEND_REASON_MIN_AFFINITY) {
    return null;
  }
  return { type: 'genre', key: bestGenre };
}

/** @deprecated prefer recommendationReasonDescriptor */
export function recommendationReasonKey(media, profile) {
  const descriptor = recommendationReasonDescriptor(media, profile);
  if (!descriptor) {
    return null;
  }
  return descriptor.type === 'genre' ? descriptor.key : descriptor.key;
}

export function formatRecommendationReason(t, media, profile) {
  const descriptor = recommendationReasonDescriptor(media, profile);
  if (!descriptor || typeof t !== 'function') {
    return null;
  }
  if (descriptor.type === 'history') {
    return t('discover.basedOnWatchingHistory');
  }
  if (descriptor.type === 'pair') {
    const parts = parseGenrePairKey(descriptor.key);
    if (!parts) {
      return null;
    }
    const left = formatGenreLabel(t, parts[0]);
    const right = formatGenreLabel(t, parts[1]);
    if (!left || !right) {
      return null;
    }
    // Prefer readable "Crime Dramas" when drama is one side.
    const dramaSide = parts[0] === 'drama' ? right : parts[1] === 'drama' ? left : null;
    if (dramaSide && (parts[0] === 'drama' || parts[1] === 'drama')) {
      const other = parts[0] === 'drama' ? right : left;
      return t('discover.becauseYouEnjoyCombo', { combo: `${other} ${t('catalog.genres.drama')}s` });
    }
    return t('discover.becauseYouEnjoyCombo', { combo: `${left} & ${right}` });
  }
  const label = formatGenreLabel(t, descriptor.key);
  if (!label) {
    return null;
  }
  return t('discover.becauseYouLike', { genre: label });
}

/** Cold-start / confidence copy for Discover rails and See All. */
export function discoverPreferenceMessage(t, profile) {
  if (!profile || typeof t !== 'function') {
    return null;
  }
  if (profile.ready && profile.confidence === PREFERENCE_CONFIDENCE_HISTORY) {
    return t('discover.basedOnWatchingHistory');
  }
  if (profile.ready) {
    return null;
  }
  if (profile.reason === 'insufficient_history') {
    return t('discover.rateOrWatchMoreToUnlock');
  }
  return profile.mediaKind === 'show'
    ? t('discover.rateShowsToUnlock')
    : t('discover.rateMoviesToUnlock');
}

/**
 * Rank Discover candidates with preference profile. Excludes watched/completed.
 * Deprioritizes already-watchlisted items without removing them.
 */
export function buildDiscoverRecommendations(candidates, {
  profile,
  mediaKind = 'movie',
  moviesState = {},
  showsState = {},
  resolveShow,
  limit = DISCOVER_RECOMMEND_RAIL_LIMIT,
  t = null,
  getId = (item) => item?.id,
  getTitle = (item) => item?.title || '',
  getMedia = (item) => item,
} = {}) {
  const kind = mediaKind === 'show' ? 'show' : 'movie';
  const filtered = [];
  const seen = new Set();
  (Array.isArray(candidates) ? candidates : []).forEach((item) => {
    const id = String(getId(item) || '').trim();
    if (!id || seen.has(id)) {
      return;
    }
    if (kind === 'movie' && isMovieExcludedFromDiscover(id, moviesState)) {
      return;
    }
    if (kind === 'show' && isShowExcludedFromDiscover(id, showsState, resolveShow)) {
      return;
    }
    seen.add(id);
    filtered.push(item);
  });

  if (!profile?.ready) {
    return {
      ready: false,
      reason: profile?.reason || 'insufficient_ratings',
      items: [],
      total: 0,
    };
  }

  const ranked = rankCandidates(filtered, {
    profile,
    mode: WATCHLIST_SORT_FOR_YOU,
    getId,
    getTitle,
    getMedia,
  });

  const watchlisted = [];
  const fresh = [];
  ranked.forEach((item) => {
    const id = getId(item);
    const entry = kind === 'movie' ? moviesState?.[id] : showsState?.[id];
    const onList = kind === 'movie' ? isMovieWatchlisted(entry) : isShowWatchlisted(entry);
    if (onList) {
      watchlisted.push(item);
    } else {
      fresh.push(item);
    }
  });
  const orderedFull = [...fresh, ...watchlisted];
  const max = Number.isFinite(limit) ? Math.max(0, limit) : orderedFull.length;
  const ordered = orderedFull.slice(0, max);

  return {
    ready: true,
    reason: null,
    total: orderedFull.length,
    items: ordered.map((item) => {
      const media = getMedia(item);
      const id = getId(item);
      const descriptor = recommendationReasonDescriptor(media, profile);
      return {
        item,
        id,
        media,
        score: scoreCandidate(media, profile, { id }),
        reasonGenre: descriptor?.type === 'genre' ? descriptor.key : descriptor?.key || null,
        reasonDescriptor: descriptor,
        genreLine: typeof t === 'function' ? mediaGenreLine(t, media, { limit: 2 }) : null,
        reason: typeof t === 'function' ? formatRecommendationReason(t, media, profile) : null,
      };
    }),
  };
}
