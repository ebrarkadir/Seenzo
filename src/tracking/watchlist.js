import { appendWatchlistId, emptyWatchlistOrderMeta, markWatchlistOrderDirty, reconcileWatchlistOrders, removeWatchlistId } from './watchlistOrder';
import { normalizeWatchlistAddedAt, nowWatchlistAddedAt } from './watchlistSort';

export function clampRating(rating) {
  if (rating == null || rating === '') {
    return null;
  }
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return null;
  }
  return value;
}

export function showEntry(partial = {}) {
  const intent = partial.intent || 'plan';
  const onPlan = intent === 'plan';
  return {
    intent,
    watchedEpisodeIds: Array.isArray(partial.watchedEpisodeIds) ? partial.watchedEpisodeIds : [],
    rating: partial.rating ?? null,
    watchlistAddedAt: onPlan ? normalizeWatchlistAddedAt(partial.watchlistAddedAt) : null,
  };
}

function movieEntry(partial = {}) {
  const next = {
    saved: true,
    watched: false,
    rating: null,
    watchlistAddedAt: null,
    ...partial,
  };
  const onWatchlist = Boolean(next.saved) && !Boolean(next.watched);
  return {
    saved: Boolean(next.saved),
    watched: Boolean(next.watched),
    rating: next.rating ?? null,
    watchlistAddedAt: onWatchlist ? normalizeWatchlistAddedAt(next.watchlistAddedAt) : null,
  };
}

export function isShowWatchlisted(entry) {
  return entry?.intent === 'plan';
}

export function isMovieWatchlisted(entry) {
  return Boolean(entry?.saved && !entry.watched);
}

export function showBookmarkVisible(entry) {
  return !entry || entry.intent === 'plan';
}

export function movieBookmarkVisible(entry) {
  return !entry?.watched;
}

export function removeTrackedShow(prev, showId) {
  const entry = prev.shows[showId];
  if (!entry) {
    return prev;
  }
  const shows = { ...prev.shows };
  delete shows[showId];
  const showRatings = { ...(prev.showRatings || {}) };
  if (entry.rating != null) {
    showRatings[showId] = entry.rating;
  }
  const wasPlan = entry.intent === 'plan';
  return reconcileWatchlistOrders({
    ...prev,
    shows,
    showRatings,
    showWatchlistOrder: wasPlan
      ? removeWatchlistId(prev.showWatchlistOrder, showId)
      : prev.showWatchlistOrder,
    watchlistOrderMeta: wasPlan
      ? markWatchlistOrderDirty(prev.watchlistOrderMeta, 'show')
      : prev.watchlistOrderMeta,
  });
}

export function applyShowWatchlistToggle(prev, showId) {
  const entry = prev.shows?.[showId];
  if (entry && entry.intent !== 'plan') {
    return prev;
  }
  if (entry) {
    return removeTrackedShow(prev, showId);
  }
  const carried = prev.showRatings?.[showId] ?? null;
  const showRatings = { ...(prev.showRatings || {}) };
  delete showRatings[showId];
  return reconcileWatchlistOrders({
    ...prev,
    showRatings,
    shows: {
      ...prev.shows,
      [showId]: showEntry({
        rating: carried,
        watchlistAddedAt: nowWatchlistAddedAt(),
      }),
    },
    showWatchlistOrder: appendWatchlistId(prev.showWatchlistOrder, showId),
    watchlistOrderMeta: markWatchlistOrderDirty(prev.watchlistOrderMeta, 'show'),
  });
}

export function applyMovieWatchlistToggle(prev, movieId) {
  const current = prev.movies?.[movieId];
  if (current?.watched) {
    return prev;
  }
  if (current?.saved) {
    if (current.rating == null) {
      const movies = { ...prev.movies };
      delete movies[movieId];
      return reconcileWatchlistOrders({
        ...prev,
        movies,
        movieWatchlistOrder: removeWatchlistId(prev.movieWatchlistOrder, movieId),
        watchlistOrderMeta: markWatchlistOrderDirty(prev.watchlistOrderMeta, 'movie'),
      });
    }
    return reconcileWatchlistOrders({
      ...prev,
      movies: {
        ...prev.movies,
        [movieId]: movieEntry({ ...current, saved: false, watched: false, watchlistAddedAt: null }),
      },
      movieWatchlistOrder: removeWatchlistId(prev.movieWatchlistOrder, movieId),
      watchlistOrderMeta: markWatchlistOrderDirty(prev.watchlistOrderMeta, 'movie'),
    });
  }
  return reconcileWatchlistOrders({
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: movieEntry({
        saved: true,
        watched: false,
        rating: current?.rating ?? null,
        watchlistAddedAt: nowWatchlistAddedAt(),
      }),
    },
    movieWatchlistOrder: appendWatchlistId(prev.movieWatchlistOrder, movieId),
    watchlistOrderMeta: markWatchlistOrderDirty(prev.watchlistOrderMeta, 'movie'),
  });
}

export function applyShowIntent(prev, showId, intent) {
  const existing = prev.shows?.[showId];
  const carried = existing?.rating ?? prev.showRatings?.[showId] ?? null;
  const showRatings = { ...(prev.showRatings || {}) };
  delete showRatings[showId];
  const wasPlan = existing?.intent === 'plan';
  const willPlan = intent === 'plan';
  let showWatchlistOrder = prev.showWatchlistOrder;
  let watchlistOrderMeta = prev.watchlistOrderMeta;
  let watchlistAddedAt = null;
  if (wasPlan && !willPlan) {
    showWatchlistOrder = removeWatchlistId(prev.showWatchlistOrder, showId);
    watchlistOrderMeta = markWatchlistOrderDirty(prev.watchlistOrderMeta, 'show');
  } else if (!wasPlan && willPlan) {
    showWatchlistOrder = appendWatchlistId(prev.showWatchlistOrder, showId);
    watchlistOrderMeta = markWatchlistOrderDirty(prev.watchlistOrderMeta, 'show');
    watchlistAddedAt = nowWatchlistAddedAt();
  } else if (willPlan) {
    watchlistAddedAt = normalizeWatchlistAddedAt(existing?.watchlistAddedAt);
  }
  return reconcileWatchlistOrders({
    ...prev,
    showRatings,
    shows: {
      ...prev.shows,
      [showId]: showEntry({
        intent,
        watchedEpisodeIds: existing?.watchedEpisodeIds || [],
        rating: existing?.rating ?? carried,
        watchlistAddedAt,
      }),
    },
    showWatchlistOrder,
    watchlistOrderMeta,
  });
}

export function applyMovieChanges(prev, movieId, changes) {
  const current = prev.movies?.[movieId];
  const next = {
    saved: true,
    watched: false,
    rating: null,
    watchlistAddedAt: null,
    ...current,
    ...changes,
  };
  const wasWatchlisted = Boolean(current?.saved && !current?.watched);
  const willWatchlisted = Boolean(next.saved) && !Boolean(next.watched);
  let movieWatchlistOrder = prev.movieWatchlistOrder;
  let watchlistOrderMeta = prev.watchlistOrderMeta;
  let watchlistAddedAt = null;
  if (wasWatchlisted && !willWatchlisted) {
    movieWatchlistOrder = removeWatchlistId(prev.movieWatchlistOrder, movieId);
    watchlistOrderMeta = markWatchlistOrderDirty(prev.watchlistOrderMeta, 'movie');
  } else if (!wasWatchlisted && willWatchlisted) {
    movieWatchlistOrder = appendWatchlistId(prev.movieWatchlistOrder, movieId);
    watchlistOrderMeta = markWatchlistOrderDirty(prev.watchlistOrderMeta, 'movie');
    watchlistAddedAt = nowWatchlistAddedAt();
  } else if (willWatchlisted) {
    watchlistAddedAt = normalizeWatchlistAddedAt(
      changes.watchlistAddedAt !== undefined ? changes.watchlistAddedAt : current?.watchlistAddedAt,
    );
  }
  return reconcileWatchlistOrders({
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: {
        saved: Boolean(next.saved),
        watched: Boolean(next.watched),
        rating: clampRating(next.rating),
        watchlistAddedAt,
      },
    },
    movieWatchlistOrder,
    watchlistOrderMeta,
  });
}

export function applyShowRating(prev, showId, rating) {
  const value = clampRating(rating);
  const entry = prev.shows?.[showId];
  if (entry) {
    const showRatings = { ...(prev.showRatings || {}) };
    delete showRatings[showId];
    return {
      ...prev,
      showRatings,
      shows: {
        ...prev.shows,
        [showId]: { ...entry, rating: value },
      },
    };
  }
  const showRatings = { ...(prev.showRatings || {}) };
  if (value == null) {
    delete showRatings[showId];
  } else {
    showRatings[showId] = value;
  }
  return { ...prev, showRatings };
}

export function isEpisodeWatched(state, episodeId) {
  if (!episodeId || !state) {
    return false;
  }
  if (Object.values(state.shows || {}).some((entry) => (entry.watchedEpisodeIds || []).includes(episodeId))) {
    return true;
  }
  return Boolean(state.keptEpisodes?.[episodeId]?.watched);
}

export function applyEpisodeRating(prev, episodeId, rating) {
  if (!episodeId || !isEpisodeWatched(prev, episodeId)) {
    return prev;
  }
  const episodeRatings = { ...(prev.episodeRatings || {}) };
  const value = clampRating(rating);
  if (value == null) {
    delete episodeRatings[episodeId];
  } else {
    episodeRatings[episodeId] = value;
  }
  return { ...prev, episodeRatings };
}

export function applyMovieRating(prev, movieId, rating) {
  const current = prev.movies?.[movieId];
  // Ratings can only be submitted/edited/removed while watched.
  // Unwatching preserves any stored rating; it just locks further edits.
  if (!current?.watched) {
    return prev;
  }
  const value = clampRating(rating);
  return {
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: movieEntry({
        saved: current.saved ?? false,
        watched: true,
        rating: value,
      }),
    },
  };
}

function ratingMap(value) {
  const next = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }
  Object.entries(value).forEach(([key, rating]) => {
    const clamped = clampRating(rating);
    if (clamped != null) {
      next[key] = clamped;
    }
  });
  return next;
}

function uniqueIds(ids) {
  const seen = new Set();
  const next = [];
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    if (typeof id !== 'string' || !id || seen.has(id)) {
      return;
    }
    seen.add(id);
    next.push(id);
  });
  return next;
}

export function normalizeTracking(raw) {
  const empty = reconcileWatchlistOrders({
    onboardingComplete: false,
    demoMode: false,
    shows: {},
    movies: {},
    showRatings: {},
    episodeRatings: {},
    episodeMeta: {},
    keptEpisodes: {},
    activityEvents: [],
    movieWatchlistOrder: [],
    showWatchlistOrder: [],
    watchlistOrderMeta: emptyWatchlistOrderMeta(),
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }
  const sourceShows = raw.shows && typeof raw.shows === 'object' && !Array.isArray(raw.shows) ? raw.shows : {};
  const sourceMovies = raw.movies && typeof raw.movies === 'object' && !Array.isArray(raw.movies) ? raw.movies : {};
  const migrated = migrateFavorites({
    shows: sourceShows,
    movies: sourceMovies,
    favorites: raw.favorites,
  });
  const shows = {};
  Object.entries(migrated.shows || {}).forEach(([id, entry]) => {
    if (!id || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }
    const watchedEpisodeIds = uniqueIds(entry.watchedEpisodeIds);
    let intent = entry.intent;
    if (intent !== 'plan' && intent !== 'watching' && intent !== 'dropped') {
      intent = watchedEpisodeIds.length ? 'watching' : 'plan';
    }
    const onPlan = intent === 'plan';
    shows[id] = {
      intent,
      watchedEpisodeIds,
      rating: clampRating(entry.rating),
      watchlistAddedAt: onPlan ? normalizeWatchlistAddedAt(entry.watchlistAddedAt) : null,
    };
  });
  const movies = {};
  Object.entries(migrated.movies || {}).forEach(([id, entry]) => {
    if (!id || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }
    const saved = Boolean(entry.saved);
    const watched = Boolean(entry.watched);
    const rating = clampRating(entry.rating);
    if (!saved && !watched && rating == null) {
      return;
    }
    const onWatchlist = saved && !watched;
    movies[id] = {
      saved,
      watched,
      rating,
      watchlistAddedAt: onWatchlist ? normalizeWatchlistAddedAt(entry.watchlistAddedAt) : null,
    };
  });
  const metaRaw = raw.watchlistOrderMeta && typeof raw.watchlistOrderMeta === 'object'
    ? raw.watchlistOrderMeta
    : {};
  return reconcileWatchlistOrders({
    onboardingComplete: Boolean(raw.onboardingComplete),
    demoMode: Boolean(raw.demoMode),
    shows,
    movies,
    showRatings: ratingMap(raw.showRatings),
    episodeRatings: ratingMap(raw.episodeRatings),
    episodeMeta: episodeMetaMap(raw.episodeMeta),
    keptEpisodes: keptEpisodeMap(raw.keptEpisodes),
    activityEvents: normalizeActivityEventList(raw.activityEvents),
    movieWatchlistOrder: Array.isArray(raw.movieWatchlistOrder) ? raw.movieWatchlistOrder : [],
    showWatchlistOrder: Array.isArray(raw.showWatchlistOrder) ? raw.showWatchlistOrder : [],
    watchlistOrderMeta: {
      movie: {
        revision: Number(metaRaw.movie?.revision) || 0,
        dirty: Boolean(metaRaw.movie?.dirty),
      },
      show: {
        revision: Number(metaRaw.show?.revision) || 0,
        dirty: Boolean(metaRaw.show?.dirty),
      },
    },
  });
}

function normalizeActivityEventList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const byId = new Map();
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const clientEventId = typeof entry.clientEventId === 'string' ? entry.clientEventId : '';
    const mediaType = entry.mediaType;
    const mediaId = entry.mediaId;
    const action = entry.action;
    const source = entry.source;
    const clientLoggedAt = typeof entry.clientLoggedAt === 'string' ? entry.clientLoggedAt : '';
    if (!clientEventId || !mediaType || !mediaId || !action || !source || !clientLoggedAt) {
      return;
    }
    if (mediaType !== 'movie' && mediaType !== 'episode') {
      return;
    }
    if (action !== 'watched' && action !== 'unwatched') {
      return;
    }
    if (source !== 'individual' && source !== 'season_bulk' && source !== 'show_bulk' && source !== 'undo') {
      return;
    }
    if (mediaType === 'movie' && !/^trakt-movie-[0-9]+$/.test(mediaId)) {
      return;
    }
    if (mediaType === 'episode' && (!/^trakt-episode-[0-9]+$/.test(mediaId) || !/^trakt-show-[0-9]+$/.test(entry.showMediaId || ''))) {
      return;
    }
    byId.set(clientEventId, {
      clientEventId,
      mediaType,
      mediaId,
      showMediaId: mediaType === 'episode' ? entry.showMediaId : null,
      action,
      source,
      clientLoggedAt,
      serverRecordedAt: typeof entry.serverRecordedAt === 'string' ? entry.serverRecordedAt : null,
    });
  });
  return [...byId.values()];
}

function episodeMetaMap(value) {
  const next = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }
  Object.entries(value).forEach(([episodeId, entry]) => {
    const meta = keptEpisodeMap({ [episodeId]: entry })[episodeId];
    if (!meta) {
      return;
    }
    next[episodeId] = {
      showId: meta.showId,
      season: meta.season,
      number: meta.number,
      watchedAt: meta.watchedAt,
    };
  });
  return next;
}

function keptEpisodeMap(value) {
  const next = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }
  Object.entries(value).forEach(([episodeId, entry]) => {
    if (!/^trakt-episode-[0-9]+$/.test(episodeId) || !entry || typeof entry !== 'object') {
      return;
    }
    if (!/^trakt-show-[0-9]+$/.test(entry.showId)) {
      return;
    }
    const season = Number(entry.season);
    const number = Number(entry.number);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(number) || number < 1) {
      return;
    }
    next[episodeId] = {
      showId: entry.showId,
      season,
      number,
      watched: Boolean(entry.watched),
      rating: clampRating(entry.rating),
      watchedAt: typeof entry.watchedAt === 'string' ? entry.watchedAt : null,
    };
  });
  return next;
}

export function migrateFavorites(state) {
  const favorites = state?.favorites;
  const shows = { ...(state?.shows || {}) };
  const movies = { ...(state?.movies || {}) };
  Object.keys(favorites?.shows || {}).forEach((id) => {
    if (!shows[id]) {
      shows[id] = showEntry();
    }
  });
  Object.keys(favorites?.movies || {}).forEach((id) => {
    if (!movies[id]) {
      movies[id] = movieEntry();
    }
  });
  return { shows, movies };
}
