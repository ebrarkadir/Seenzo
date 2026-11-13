import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { demoTracking } from '../data/demoTracking';
import { getMovie, getShow } from '../data/catalog';
import { getNextEpisode, isReleased, watchedThroughIds } from './status';

const STORAGE_KEY = 'seenzo.tracking.v1';

const TrackingContext = createContext(null);

function emptyState() {
  return {
    onboardingComplete: false,
    demoMode: false,
    shows: {},
    movies: {},
    favorites: { shows: {}, movies: {} },
    showRatings: {},
    episodeRatings: {},
  };
}

function showEntry(partial = {}) {
  return {
    intent: partial.intent || 'plan',
    watchedEpisodeIds: partial.watchedEpisodeIds || [],
    rating: partial.rating ?? null,
  };
}

function movieEntry(partial) {
  return {
    saved: true,
    watched: false,
    rating: null,
    ...partial,
  };
}

function idMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function ratingMap(value) {
  const next = {};
  Object.entries(idMap(value)).forEach(([key, rating]) => {
    const clamped = clampRating(rating);
    if (clamped != null) {
      next[key] = clamped;
    }
  });
  return next;
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') {
    return emptyState();
  }
  const favorites = raw.favorites && typeof raw.favorites === 'object' ? raw.favorites : {};
  return {
    onboardingComplete: Boolean(raw.onboardingComplete),
    demoMode: Boolean(raw.demoMode),
    shows: raw.shows && typeof raw.shows === 'object' ? raw.shows : {},
    movies: raw.movies && typeof raw.movies === 'object' ? raw.movies : {},
    favorites: {
      shows: idMap(favorites.shows),
      movies: idMap(favorites.movies),
    },
    showRatings: ratingMap(raw.showRatings),
    episodeRatings: ratingMap(raw.episodeRatings),
  };
}

function clampRating(rating) {
  if (rating == null) {
    return null;
  }
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return null;
  }
  return value;
}

export function TrackingProvider({ children }) {
  const [state, setState] = useState(emptyState);
  const [ready, setReady] = useState(false);
  const [undo, setUndo] = useState(null);
  const undoRef = useRef(null);

  const updateUndo = useCallback((value) => {
    undoRef.current = value;
    setUndo(value);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && stored) {
          setState(normalize(JSON.parse(stored)));
        }
      } catch {
        if (active) {
          setState(emptyState());
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [ready, state]);

  const dismissUndo = useCallback(() => {
    updateUndo(null);
  }, [updateUndo]);

  const undoLast = useCallback(() => {
    const current = undoRef.current;
    if (!current) {
      return;
    }
    updateUndo(null);
    setState((prev) => {
      const entry = prev.shows[current.showId];
      if (!entry) {
        return prev;
      }
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [current.showId]: {
            ...entry,
            watchedEpisodeIds: (entry.watchedEpisodeIds || []).filter((id) => id !== current.episodeId),
          },
        },
      };
    });
  }, [updateUndo]);

  const markNextWatched = useCallback((showId) => {
    const show = getShow(showId);
    if (!show) {
      return;
    }
    let marked = null;
    setState((prev) => {
      const entry = prev.shows[showId];
      if (!entry) {
        return prev;
      }
      const next = getNextEpisode(show, entry);
      if (!next) {
        return prev;
      }
      marked = next;
      const watchedEpisodeIds = entry.watchedEpisodeIds || [];
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: {
            ...entry,
            intent: entry.intent === 'plan' ? 'watching' : entry.intent,
            watchedEpisodeIds: watchedEpisodeIds.includes(next.id)
              ? watchedEpisodeIds
              : [...watchedEpisodeIds, next.id],
          },
        },
      };
    });
    if (marked) {
      updateUndo({
        showId,
        episodeId: marked.id,
        episodeTitleKey: marked.titleKey,
      });
    }
  }, [updateUndo]);

  const toggleEpisode = useCallback((showId, episodeId) => {
    const show = getShow(showId);
    const episode = show && show.seasons.flatMap((season) => season.episodes).find((item) => item.id === episodeId);
    if (!show || !episode || !isReleased(episode)) {
      return;
    }
    let marked = null;
    setState((prev) => {
      const entry = prev.shows[showId] || showEntry({ intent: 'watching' });
      const watchedEpisodeIds = entry.watchedEpisodeIds || [];
      const alreadyWatched = watchedEpisodeIds.includes(episodeId);
      if (!alreadyWatched) {
        marked = episode;
      }
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: {
            ...entry,
            intent: entry.intent === 'plan' ? 'watching' : entry.intent,
            watchedEpisodeIds: alreadyWatched
              ? watchedEpisodeIds.filter((id) => id !== episodeId)
              : [...watchedEpisodeIds, episodeId],
          },
        },
      };
    });
    if (marked) {
      updateUndo({
        showId,
        episodeId: marked.id,
        episodeTitleKey: marked.titleKey,
      });
    } else {
      updateUndo(null);
    }
  }, [updateUndo]);

  const setShowIntent = useCallback((showId, intent) => {
    if (!getShow(showId)) {
      return;
    }
    updateUndo(null);
    setState((prev) => {
      const existing = prev.shows[showId];
      const carried = existing?.rating ?? prev.showRatings?.[showId] ?? null;
      const entry = existing || showEntry({ rating: carried });
      const showRatings = { ...(prev.showRatings || {}) };
      delete showRatings[showId];
      return {
        ...prev,
        showRatings,
        shows: {
          ...prev.shows,
          [showId]: { ...entry, intent, rating: entry.rating ?? carried },
        },
      };
    });
  }, [updateUndo]);

  const removeShow = useCallback((showId) => {
    updateUndo(null);
    setState((prev) => {
      if (!prev.shows[showId]) {
        return prev;
      }
      const shows = { ...prev.shows };
      delete shows[showId];
      return { ...prev, shows };
    });
  }, [updateUndo]);

  const setShowRating = useCallback((showId, rating) => {
    if (!getShow(showId)) {
      return;
    }
    setState((prev) => {
      const value = clampRating(rating);
      const entry = prev.shows[showId];
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
    });
  }, []);

  const setEpisodeRating = useCallback((episodeId, rating) => {
    if (!episodeId) {
      return;
    }
    setState((prev) => {
      const episodeRatings = { ...(prev.episodeRatings || {}) };
      const value = clampRating(rating);
      if (value == null) {
        delete episodeRatings[episodeId];
      } else {
        episodeRatings[episodeId] = value;
      }
      return { ...prev, episodeRatings };
    });
  }, []);

  const toggleFavorite = useCallback((kind, id) => {
    const bucket = kind === 'movie' ? 'movies' : 'shows';
    const known = bucket === 'movies' ? getMovie(id) : getShow(id);
    if (!known) {
      return;
    }
    setState((prev) => {
      const current = { ...(prev.favorites?.[bucket] || {}) };
      if (current[id]) {
        delete current[id];
      } else {
        current[id] = true;
      }
      return {
        ...prev,
        favorites: {
          shows: prev.favorites?.shows || {},
          movies: prev.favorites?.movies || {},
          [bucket]: current,
        },
      };
    });
  }, []);

  const saveMovie = useCallback((movieId, changes) => {
    if (!getMovie(movieId)) {
      return;
    }
    setState((prev) => {
      const current = prev.movies[movieId] || movieEntry({});
      return {
        ...prev,
        movies: {
          ...prev.movies,
          [movieId]: movieEntry({ ...current, ...changes }),
        },
      };
    });
  }, []);

  const removeMovie = useCallback((movieId) => {
    setState((prev) => {
      if (!prev.movies[movieId]) {
        return prev;
      }
      const movies = { ...prev.movies };
      delete movies[movieId];
      return { ...prev, movies };
    });
  }, []);

  const setMovieRating = useCallback((movieId, rating) => {
    if (!getMovie(movieId)) {
      return;
    }
    setState((prev) => {
      const current = prev.movies[movieId];
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
    });
  }, []);

  const completeOnboarding = useCallback(({ shows: selectedShows = [], movies: selectedMovies = [] }) => {
    updateUndo(null);
    setState((prev) => {
      const shows = { ...prev.shows };
      const showRatings = { ...(prev.showRatings || {}) };
      selectedShows.forEach((selection) => {
        const show = getShow(selection.id);
        if (!show) {
          return;
        }
        const keptRating = prev.shows[selection.id]?.rating ?? showRatings[selection.id] ?? null;
        delete showRatings[selection.id];
        if (!selection.throughEpisodeId) {
          shows[selection.id] = showEntry({ intent: 'plan', rating: keptRating });
          return;
        }
        shows[selection.id] = showEntry({
          intent: 'watching',
          watchedEpisodeIds: watchedThroughIds(show, selection.throughEpisodeId),
          rating: keptRating,
        });
      });

      const movies = { ...prev.movies };
      selectedMovies.forEach((movieId) => {
        if (!getMovie(movieId)) {
          return;
        }
        const existing = prev.movies[movieId];
        if (existing?.watched) {
          movies[movieId] = existing;
          return;
        }
        movies[movieId] = movieEntry({
          saved: true,
          watched: false,
          rating: existing?.rating ?? null,
        });
      });

      return {
        ...prev,
        onboardingComplete: true,
        demoMode: false,
        shows,
        movies,
        showRatings,
      };
    });
  }, [updateUndo]);

  const loadDemo = useCallback(() => {
    updateUndo(null);
    setState({
      onboardingComplete: true,
      demoMode: true,
      shows: demoTracking.shows,
      movies: demoTracking.movies,
      favorites: demoTracking.favorites || { shows: {}, movies: {} },
      showRatings: {},
      episodeRatings: demoTracking.episodeRatings || {},
    });
  }, [updateUndo]);

  const clearLocalData = useCallback(() => {
    updateUndo(null);
    setState({
      onboardingComplete: true,
      demoMode: false,
      shows: {},
      movies: {},
      favorites: { shows: {}, movies: {} },
      showRatings: {},
      episodeRatings: {},
    });
  }, [updateUndo]);

  const restartOnboarding = useCallback(() => {
    updateUndo(null);
    setState((prev) => ({ ...prev, onboardingComplete: false }));
  }, [updateUndo]);

  const value = useMemo(() => ({
    ready,
    onboardingComplete: state.onboardingComplete,
    demoMode: state.demoMode,
    shows: state.shows,
    movies: state.movies,
    favorites: state.favorites,
    showRatings: state.showRatings,
    episodeRatings: state.episodeRatings,
    undo,
    dismissUndo,
    undoLast,
    markNextWatched,
    toggleEpisode,
    setShowIntent,
    removeShow,
    setShowRating,
    setEpisodeRating,
    toggleFavorite,
    saveMovie,
    removeMovie,
    setMovieRating,
    completeOnboarding,
    loadDemo,
    clearLocalData,
    restartOnboarding,
  }), [
    ready,
    state,
    undo,
    dismissUndo,
    undoLast,
    markNextWatched,
    toggleEpisode,
    setShowIntent,
    removeShow,
    setShowRating,
    setEpisodeRating,
    toggleFavorite,
    saveMovie,
    removeMovie,
    setMovieRating,
    completeOnboarding,
    loadDemo,
    clearLocalData,
    restartOnboarding,
  ]);

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export function useTracking() {
  const context = useContext(TrackingContext);
  if (!context) {
    throw new Error('useTracking must be used within TrackingProvider');
  }
  return context;
}
