/**
 * Local preference profile for Smart Watchlist + Discover ranking.
 * V3 Hybrid Taste Profile: rating-first Bayesian affinity (V2) plus capped weak
 * signals from unrated watching progress / watched movies / plan-to-watch.
 * Episode ratings intentionally omitted.
 */

import { deriveShowStatus, releasedEpisodes } from './status';

export const PREFERENCE_ENGINE_VERSION = 3;

export const PREFERENCE_RATING_NEUTRAL = 5.5;
/** Minimum rated titles (with usable genre metadata) for rating-supported ready. */
export const PREFERENCE_MIN_RATED_WITH_GENRES = 3;
/** Minimum unrated history titles (with genres) for lower-confidence ready. */
export const PREFERENCE_MIN_HISTORY_WITH_GENRES = 5;
/** Bayesian shrink toward neutral (0 contribution) affinity. */
export const PREFERENCE_PRIOR_WEIGHT = 2;
/** Small genre affinity bump from profile favorite shelf. */
export const PREFERENCE_FAVORITE_GENRE_BOOST = 0.25;
/** Tiny candidate boost when the watchlist item itself is a favorite. */
export const PREFERENCE_FAVORITE_CANDIDATE_BOOST = 0.1;
/**
 * Genres that appear on nearly every liked title get softer weight when scoring
 * alone (e.g. Drama), so rarer co-genres (Crime) can surface.
 */
export const PREFERENCE_SPECIFICITY_SLOPE = 0.45;
/** Extra score when a candidate shares a positively learned genre pair. */
export const PREFERENCE_PAIR_BOOST = 0.35;
/** How strongly negative genre affinities pull a candidate down. */
export const PREFERENCE_NEGATIVE_WEIGHT = 0.55;
/** Pair affinity Bayesian prior (pairs are rarer than single genres). */
export const PREFERENCE_PAIR_PRIOR_WEIGHT = 1.5;

/**
 * Weak-signal calibration (same units as rating − neutral).
 * Rating 10 → +4.5; unrated max ≈ 0.20 × 4.5; watchlist ≈ 0.03 × 4.5.
 */
export const PREFERENCE_RATING_SIGNAL_WEIGHT = 1;
export const PREFERENCE_UNRATED_MAX_SIGNAL = 0.9;
export const PREFERENCE_WATCHLIST_SIGNAL = 0.135;
/** Half-confidence around this many watched released episodes. */
export const PREFERENCE_PROGRESS_EVIDENCE_PRIOR = 8;
/** Cap on sum of absolute weak genre shares before merge into affinity. */
export const PREFERENCE_WEAK_TOTAL_CAP = 1.2;
/** Cap on absolute weak bump per genre after scaling. */
export const PREFERENCE_WEAK_GENRE_CAP = 0.18;

export const PREFERENCE_CONFIDENCE_RATINGS = 'ratings';
export const PREFERENCE_CONFIDENCE_HISTORY = 'history';
export const PREFERENCE_CONFIDENCE_NONE = 'none';

export const WATCHLIST_SORT_TITLE = 'title';
export const WATCHLIST_SORT_FOR_YOU = 'forYou';
export const WATCHLIST_SORTS = [WATCHLIST_SORT_TITLE, WATCHLIST_SORT_FOR_YOU];

/**
 * Normalize genre tokens so Trakt labels and demo `genreKey` values can match.
 * Does not invent genres — empty/unknown input yields null.
 */
export function normalizeGenre(value) {
  if (value == null) {
    return null;
  }
  let raw = String(value).trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw.startsWith('catalog.genres.')) {
    raw = raw.slice('catalog.genres.'.length);
  }
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  return compact || null;
}

/**
 * Read unique normalized genres from media (`genres[]` and/or demo `genreKey`).
 */
export function mediaGenres(media) {
  if (!media || typeof media !== 'object') {
    return [];
  }
  const seen = new Set();
  const out = [];
  const push = (value) => {
    const key = normalizeGenre(value);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(key);
  };
  if (Array.isArray(media.genres)) {
    media.genres.forEach(push);
  }
  if (media.genreKey) {
    push(media.genreKey);
  }
  return out;
}

export function genrePairKey(left, right) {
  const a = normalizeGenre(left);
  const b = normalizeGenre(right);
  if (!a || !b || a === b) {
    return null;
  }
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function parseGenrePairKey(key) {
  if (typeof key !== 'string' || !key.includes('|')) {
    return null;
  }
  const [left, right] = key.split('|');
  if (!left || !right) {
    return null;
  }
  return [left, right];
}

/** Map normalized genre keys to Trakt filter/API slugs (verified public filter values). */
export function genreApiSlug(normalized) {
  const key = normalizeGenre(normalized);
  if (!key) {
    return null;
  }
  const mapped = {
    sciencefiction: 'science-fiction',
    scifi: 'science-fiction',
    sportingevent: 'sporting-event',
  };
  return mapped[key] || key;
}

function clampMovieRating(rating) {
  if (rating == null || rating === '') {
    return null;
  }
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return null;
  }
  return value;
}

function uniqueIds(values) {
  const seen = new Set();
  const out = [];
  (values || []).forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    out.push(id);
  });
  return out;
}

function traktNumericId(mediaId, mediaKind) {
  const pattern = mediaKind === 'show' ? /^trakt-show-(\d+)$/ : /^trakt-movie-(\d+)$/;
  const match = pattern.exec(String(mediaId || ''));
  return match ? match[1] : null;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addWeakGenreShares(targetMap, genres, signal) {
  if (!genres.length || !signal) {
    return;
  }
  const share = signal / genres.length;
  genres.forEach((genre) => {
    targetMap.set(genre, (targetMap.get(genre) || 0) + share);
  });
}

/**
 * Progress interest for one show using released episodes only.
 * Does not invent a denominator when released metadata is missing.
 *
 * interest = UNRATED_MAX * ratio * confidence
 * confidence = watched / (watched + PROGRESS_EVIDENCE_PRIOR)
 */
export function computeShowProgressInterest(show, entry, today) {
  const released = releasedEpisodes(show, today);
  const watchedSet = new Set(entry?.watchedEpisodeIds || []);
  if (!released.length) {
    return {
      reliable: false,
      watched: 0,
      total: 0,
      ratio: null,
      confidence: 0,
      interest: 0,
    };
  }
  const watched = released.filter((episode) => watchedSet.has(episode.id)).length;
  const total = released.length;
  const ratio = watched / total;
  const confidence = watched / (watched + PREFERENCE_PROGRESS_EVIDENCE_PRIOR);
  const interest = PREFERENCE_UNRATED_MAX_SIGNAL * ratio * confidence;
  return {
    reliable: true,
    watched,
    total,
    ratio,
    confidence,
    interest,
  };
}

function collectRatedMedia(state, {
  mediaKind,
  resolveMovie,
  resolveShow,
}) {
  const rows = [];
  if (mediaKind === 'movie') {
    Object.entries(state?.movies || {}).forEach(([movieId, entry]) => {
      const rating = clampMovieRating(entry?.rating);
      if (rating == null) {
        return;
      }
      const media = typeof resolveMovie === 'function' ? resolveMovie(movieId) : null;
      rows.push({ id: movieId, rating, media, genres: mediaGenres(media) });
    });
    return rows;
  }
  const showIds = new Set([
    ...Object.keys(state?.shows || {}),
    ...Object.keys(state?.showRatings || {}).filter((id) => state.showRatings[id] != null),
  ]);
  showIds.forEach((showId) => {
    const rating = clampMovieRating(state?.shows?.[showId]?.rating ?? state?.showRatings?.[showId]);
    if (rating == null) {
      return;
    }
    const media = typeof resolveShow === 'function' ? resolveShow(showId) : null;
    rows.push({ id: showId, rating, media, genres: mediaGenres(media) });
  });
  return rows;
}

/**
 * Collect capped weak preference contributions (unrated history + plan/watchlist).
 * Rated titles never emit a weak contribution (no double count).
 */
export function collectWeakContributions(state, {
  mediaKind = 'movie',
  resolveMovie,
  resolveShow,
  today,
} = {}) {
  const kind = mediaKind === 'show' ? 'show' : 'movie';
  const contributions = [];

  if (kind === 'movie') {
    Object.entries(state?.movies || {}).forEach(([movieId, entry]) => {
      if (clampMovieRating(entry?.rating) != null) {
        return;
      }
      const media = typeof resolveMovie === 'function' ? resolveMovie(movieId) : null;
      const genres = mediaGenres(media);
      if (!genres.length) {
        return;
      }
      if (entry?.watched) {
        contributions.push({
          id: movieId,
          source: 'unrated_watched',
          genres,
          signal: PREFERENCE_UNRATED_MAX_SIGNAL,
        });
        return;
      }
      if (entry?.saved && !entry?.watched) {
        contributions.push({
          id: movieId,
          source: 'watchlist',
          genres,
          signal: PREFERENCE_WATCHLIST_SIGNAL,
        });
      }
    });
    return contributions;
  }

  Object.entries(state?.shows || {}).forEach(([showId, entry]) => {
    if (clampMovieRating(entry?.rating ?? state?.showRatings?.[showId]) != null) {
      return;
    }
    const media = typeof resolveShow === 'function' ? resolveShow(showId) : null;
    const genres = mediaGenres(media);
    if (!genres.length) {
      return;
    }
    const intent = entry?.intent || 'plan';
    if (intent === 'plan') {
      contributions.push({
        id: showId,
        source: 'watchlist',
        genres,
        signal: PREFERENCE_WATCHLIST_SIGNAL,
      });
      return;
    }
    if (intent === 'dropped') {
      return;
    }
    const progress = computeShowProgressInterest(media, entry, today);
    if (!progress.reliable || progress.interest <= 0) {
      return;
    }
    const status = deriveShowStatus(media, entry, today);
    contributions.push({
      id: showId,
      source: status === 'completed' || status === 'caughtUp' ? 'unrated_progress' : 'unrated_watching',
      genres,
      signal: progress.interest,
      progress,
    });
  });

  return contributions;
}

function applyWeakCap(weakSums) {
  const capped = new Map();
  let totalAbs = 0;
  weakSums.forEach((value) => {
    totalAbs += Math.abs(value);
  });
  const scale = totalAbs > PREFERENCE_WEAK_TOTAL_CAP && totalAbs > 0
    ? PREFERENCE_WEAK_TOTAL_CAP / totalAbs
    : 1;
  weakSums.forEach((value, genre) => {
    let next = value * scale;
    if (next > PREFERENCE_WEAK_GENRE_CAP) {
      next = PREFERENCE_WEAK_GENRE_CAP;
    } else if (next < -PREFERENCE_WEAK_GENRE_CAP) {
      next = -PREFERENCE_WEAK_GENRE_CAP;
    }
    if (next) {
      capped.set(genre, next);
    }
  });
  return { capped, scale };
}

/**
 * Build a reusable preference profile from movie or show ratings (not episodes),
 * plus capped weak unrated/watchlist interest (V3).
 */
export function buildPreferenceProfile(state, {
  mediaKind = 'movie',
  resolveMovie,
  resolveShow,
  favoriteMovieIds = [],
  favoriteShowIds = [],
  today,
} = {}) {
  const sums = new Map();
  const counts = new Map();
  const pairSums = new Map();
  const pairCounts = new Map();
  const kind = mediaKind === 'show' ? 'show' : 'movie';
  const ratedRows = collectRatedMedia(state, { mediaKind: kind, resolveMovie, resolveShow });
  let ratedCount = ratedRows.length;
  let ratedWithGenresCount = 0;

  ratedRows.forEach((row) => {
    const genres = row.genres;
    if (!genres.length) {
      return;
    }
    ratedWithGenresCount += 1;
    const signal = (row.rating - PREFERENCE_RATING_NEUTRAL) * PREFERENCE_RATING_SIGNAL_WEIGHT;
    const share = signal / genres.length;
    genres.forEach((genre) => {
      sums.set(genre, (sums.get(genre) || 0) + share);
      counts.set(genre, (counts.get(genre) || 0) + 1);
    });
    // Learn co-occurring pairs from the same rated title (positive and mild negative).
    for (let i = 0; i < genres.length; i += 1) {
      for (let j = i + 1; j < genres.length; j += 1) {
        const pair = genrePairKey(genres[i], genres[j]);
        if (!pair) {
          continue;
        }
        // Pair gets the full title signal (not per-genre share) so combos stay distinctive.
        pairSums.set(pair, (pairSums.get(pair) || 0) + signal);
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  });

  const genreAffinity = {};
  const genreCounts = {};
  counts.forEach((count, genre) => {
    const sum = sums.get(genre) || 0;
    genreAffinity[genre] = sum / (count + PREFERENCE_PRIOR_WEIGHT);
    genreCounts[genre] = count;
  });

  const pairAffinity = {};
  pairCounts.forEach((count, pair) => {
    const sum = pairSums.get(pair) || 0;
    pairAffinity[pair] = sum / (count + PREFERENCE_PAIR_PRIOR_WEIGHT);
  });

  const favorites = uniqueIds(kind === 'movie' ? favoriteMovieIds : favoriteShowIds);
  favorites.forEach((mediaId) => {
    const media = kind === 'movie'
      ? (typeof resolveMovie === 'function' ? resolveMovie(mediaId) : null)
      : (typeof resolveShow === 'function' ? resolveShow(mediaId) : null);
    const genres = mediaGenres(media);
    genres.forEach((genre) => {
      genreAffinity[genre] = (genreAffinity[genre] || 0) + PREFERENCE_FAVORITE_GENRE_BOOST;
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
    for (let i = 0; i < genres.length; i += 1) {
      for (let j = i + 1; j < genres.length; j += 1) {
        const pair = genrePairKey(genres[i], genres[j]);
        if (!pair) {
          continue;
        }
        pairAffinity[pair] = (pairAffinity[pair] || 0) + PREFERENCE_FAVORITE_GENRE_BOOST * 0.5;
      }
    }
  });

  const weakRaw = collectWeakContributions(state, {
    mediaKind: kind,
    resolveMovie,
    resolveShow,
    today,
  });
  const weakSums = new Map();
  const weakById = {};
  weakRaw.forEach((row) => {
    addWeakGenreShares(weakSums, row.genres, row.signal);
    const share = row.signal / row.genres.length;
    weakById[row.id] = {
      id: row.id,
      source: row.source,
      genres: row.genres.slice(),
      signal: row.signal,
      perGenre: share,
      progress: row.progress || null,
    };
  });
  const { capped: weakCapped, scale: weakScale } = applyWeakCap(weakSums);
  const weakGenreAffinity = {};
  weakCapped.forEach((value, genre) => {
    weakGenreAffinity[genre] = value;
    genreAffinity[genre] = (genreAffinity[genre] || 0) + value;
  });

  const historyWithGenresCount = weakRaw.filter((row) => (
    row.source === 'unrated_watched'
    || row.source === 'unrated_progress'
    || row.source === 'unrated_watching'
  )).length;

  const ratingsReady = ratedWithGenresCount >= PREFERENCE_MIN_RATED_WITH_GENRES;
  const historyReady = !ratingsReady
    && historyWithGenresCount >= PREFERENCE_MIN_HISTORY_WITH_GENRES;
  const genreKeys = Object.keys(genreAffinity).sort((a, b) => a.localeCompare(b));
  const ready = (ratingsReady || historyReady) && genreKeys.length > 0;

  let confidence = PREFERENCE_CONFIDENCE_NONE;
  if (ratingsReady) {
    confidence = PREFERENCE_CONFIDENCE_RATINGS;
  } else if (historyReady) {
    confidence = PREFERENCE_CONFIDENCE_HISTORY;
  }

  let reason = null;
  if (!ready) {
    if (ratedCount === 0 && historyWithGenresCount === 0) {
      reason = 'no_ratings';
    } else if (ratedWithGenresCount > 0 && ratedWithGenresCount < PREFERENCE_MIN_RATED_WITH_GENRES) {
      reason = 'insufficient_ratings';
    } else if (ratedCount >= PREFERENCE_MIN_RATED_WITH_GENRES && ratedWithGenresCount < PREFERENCE_MIN_RATED_WITH_GENRES) {
      reason = 'insufficient_genres';
    } else if (historyWithGenresCount > 0 && historyWithGenresCount < PREFERENCE_MIN_HISTORY_WITH_GENRES) {
      reason = 'insufficient_history';
    } else {
      reason = 'insufficient_ratings';
    }
  }

  // Top positive genres for controlled catalog expansion (Discover pools).
  const topPositiveGenres = genreKeys
    .filter((genre) => (genreAffinity[genre] || 0) > 0)
    .sort((left, right) => {
      const byScore = (genreAffinity[right] || 0) - (genreAffinity[left] || 0);
      if (byScore) {
        return byScore;
      }
      return left.localeCompare(right);
    })
    .slice(0, 3);

  // Highest-rated titles with genres — seeds for related-item expansion.
  const topRatedSeeds = ratedRows
    .filter((row) => row.genres.length && row.rating >= 7)
    .sort((left, right) => {
      if (right.rating !== left.rating) {
        return right.rating - left.rating;
      }
      return String(left.id).localeCompare(String(right.id));
    })
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      rating: row.rating,
      traktId: row.media?.traktId || traktNumericId(row.id, kind) || null,
    }));

  return {
    ready,
    reason,
    confidence,
    engineVersion: PREFERENCE_ENGINE_VERSION,
    mediaKind: kind,
    ratedMovieCount: kind === 'movie' ? ratedCount : 0,
    ratedShowCount: kind === 'show' ? ratedCount : 0,
    ratedWithGenresCount,
    historyWithGenresCount,
    genreAffinity,
    genreCounts,
    pairAffinity,
    weakGenreAffinity,
    weakById,
    weakContributionCount: weakRaw.length,
    weakScale,
    topPositiveGenres,
    topRatedSeeds,
    favoriteMovieIds: kind === 'movie' ? favorites : [],
    favoriteShowIds: kind === 'show' ? favorites : [],
  };
}

export function genreSpecificityWeight(genre, profile) {
  const count = Number(profile?.genreCounts?.[genre]) || 0;
  if (count <= 1) {
    return 1;
  }
  return 1 / (1 + (count - 1) * PREFERENCE_SPECIFICITY_SLOPE);
}

export function effectiveGenreAffinity(genre, profile, affinityMap = null) {
  const source = affinityMap || profile?.genreAffinity;
  const raw = Number(source?.[genre]) || 0;
  return raw * genreSpecificityWeight(genre, profile);
}

/**
 * Affinity map for scoring one candidate: removes that candidate's own weak
 * contribution so watchlist/self interest cannot self-reinforce.
 */
export function scoringAffinityMap(profile, candidateId = null) {
  const base = { ...(profile?.genreAffinity || {}) };
  const id = candidateId != null ? String(candidateId) : '';
  const own = id && profile?.weakById ? profile.weakById[id] : null;
  if (!own?.genres?.length || !own.perGenre) {
    return base;
  }
  // Undo raw contribution, then undo the same weak-total scale applied at build time.
  const scale = Number(profile?.weakScale) > 0 ? Number(profile.weakScale) : 1;
  own.genres.forEach((genre) => {
    const undo = own.perGenre * scale;
    base[genre] = (Number(base[genre]) || 0) - undo;
  });
  return base;
}

/**
 * Score one media candidate against a preference profile.
 * V3: V2 scoring + self-reinforcement exclusion for the candidate's weak contribution.
 * Missing genres → neutral 0. Does not mutate inputs.
 */
export function scoreCandidate(media, profile, { id = null } = {}) {
  if (!profile?.ready) {
    return 0;
  }
  const candidateId = id != null ? String(id) : String(media?.id || '');
  const affinityMap = scoringAffinityMap(profile, candidateId);
  const genres = mediaGenres(media);
  let score = 0;
  if (genres.length) {
    const effective = genres.map((genre) => effectiveGenreAffinity(genre, profile, affinityMap));
    const positives = effective.filter((value) => value > 0);
    const negatives = effective.filter((value) => value < 0);
    // Do not dilute strong positives by averaging in zero-affinity filler genres.
    if (positives.length) {
      score += mean(positives);
    }
    if (negatives.length) {
      score += mean(negatives) * PREFERENCE_NEGATIVE_WEIGHT;
    }

    let bestPair = 0;
    for (let i = 0; i < genres.length; i += 1) {
      for (let j = i + 1; j < genres.length; j += 1) {
        const pair = genrePairKey(genres[i], genres[j]);
        if (!pair) {
          continue;
        }
        const pairScore = Number(profile.pairAffinity?.[pair]) || 0;
        if (pairScore > bestPair) {
          bestPair = pairScore;
        }
      }
    }
    if (bestPair > 0) {
      score += bestPair * PREFERENCE_PAIR_BOOST;
    }
  }
  const favoriteIds = [
    ...(Array.isArray(profile.favoriteMovieIds) ? profile.favoriteMovieIds : []),
    ...(Array.isArray(profile.favoriteShowIds) ? profile.favoriteShowIds : []),
  ];
  if (candidateId && favoriteIds.includes(candidateId)) {
    score += PREFERENCE_FAVORITE_CANDIDATE_BOOST;
  }
  return score;
}

/**
 * Rank candidates without mutating the input array or items.
 * For You uses score desc → title asc → id asc when profile.ready; otherwise title/id.
 */
export function rankCandidates(items, {
  profile = null,
  mode = WATCHLIST_SORT_TITLE,
  getId = (item) => item?.id,
  getTitle = (item) => item?.title || '',
  getMedia = (item) => item?.movie || item?.media || item,
} = {}) {
  const list = Array.isArray(items) ? items.slice() : [];
  const useForYou = mode === WATCHLIST_SORT_FOR_YOU && Boolean(profile?.ready);

  list.sort((left, right) => {
    if (useForYou) {
      const leftScore = scoreCandidate(getMedia(left), profile, { id: getId(left) });
      const rightScore = scoreCandidate(getMedia(right), profile, { id: getId(right) });
      if (leftScore !== rightScore) {
        return rightScore > leftScore ? 1 : -1;
      }
    }
    const byTitle = String(getTitle(left) || '').localeCompare(String(getTitle(right) || ''));
    if (byTitle) {
      return byTitle;
    }
    return String(getId(left) || '').localeCompare(String(getId(right) || ''));
  });

  return list;
}

/**
 * Whether For You should fall back to title order for this profile.
 */
export function shouldFallbackToTitle(profile) {
  return !profile?.ready;
}
