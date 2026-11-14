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
  return {
    intent: partial.intent || 'plan',
    watchedEpisodeIds: Array.isArray(partial.watchedEpisodeIds) ? partial.watchedEpisodeIds : [],
    rating: partial.rating ?? null,
  };
}

function movieEntry(partial = {}) {
  return {
    saved: true,
    watched: false,
    rating: null,
    ...partial,
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
  return { ...prev, shows, showRatings };
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
  return {
    ...prev,
    showRatings,
    shows: {
      ...prev.shows,
      [showId]: showEntry({ rating: carried }),
    },
  };
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
      return { ...prev, movies };
    }
    return {
      ...prev,
      movies: {
        ...prev.movies,
        [movieId]: movieEntry({ ...current, saved: false, watched: false }),
      },
    };
  }
  return {
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: movieEntry({
        saved: true,
        watched: false,
        rating: current?.rating ?? null,
      }),
    },
  };
}

export function applyShowIntent(prev, showId, intent) {
  const existing = prev.shows?.[showId];
  const carried = existing?.rating ?? prev.showRatings?.[showId] ?? null;
  const showRatings = { ...(prev.showRatings || {}) };
  delete showRatings[showId];
  return {
    ...prev,
    showRatings,
    shows: {
      ...prev.shows,
      [showId]: showEntry({
        intent,
        watchedEpisodeIds: existing?.watchedEpisodeIds || [],
        rating: existing?.rating ?? carried,
      }),
    },
  };
}

export function applyMovieChanges(prev, movieId, changes) {
  const current = prev.movies?.[movieId];
  const next = {
    saved: true,
    watched: false,
    rating: null,
    ...current,
    ...changes,
  };
  return {
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: {
        saved: Boolean(next.saved),
        watched: Boolean(next.watched),
        rating: clampRating(next.rating),
      },
    },
  };
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

export function applyEpisodeRating(prev, episodeId, rating) {
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
  const value = clampRating(rating);
  if (!current && value == null) {
    return prev;
  }
  if (current && value == null && !current.saved && !current.watched) {
    const movies = { ...prev.movies };
    delete movies[movieId];
    return { ...prev, movies };
  }
  return {
    ...prev,
    movies: {
      ...prev.movies,
      [movieId]: movieEntry({
        saved: current?.saved ?? false,
        watched: current?.watched ?? false,
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
  const empty = {
    onboardingComplete: false,
    demoMode: false,
    shows: {},
    movies: {},
    showRatings: {},
    episodeRatings: {},
    episodeMeta: {},
    keptEpisodes: {},
  };
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
    shows[id] = {
      intent,
      watchedEpisodeIds,
      rating: clampRating(entry.rating),
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
    movies[id] = { saved, watched, rating };
  });
  return {
    onboardingComplete: Boolean(raw.onboardingComplete),
    demoMode: Boolean(raw.demoMode),
    shows,
    movies,
    showRatings: ratingMap(raw.showRatings),
    episodeRatings: ratingMap(raw.episodeRatings),
    episodeMeta: episodeMetaMap(raw.episodeMeta),
    keptEpisodes: keptEpisodeMap(raw.keptEpisodes),
  };
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
