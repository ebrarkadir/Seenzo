function showEntry(partial = {}) {
  return {
    intent: 'plan',
    watchedEpisodeIds: [],
    rating: null,
    ...partial,
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
