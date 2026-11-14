import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../auth/AuthContext';
import { demoTracking } from '../data/demoTracking';
import { rememberMovie, rememberShow, resolveMovie as getMovie, resolveShow as getShow } from '../data/mediaLibrary';
import { parseTraktMovieKey, parseTraktShowKey } from '../services/trakt/normalize';
import { hydrateMovie, hydrateShow } from '../services/trakt/catalog';
import { pullTracking, pushTracking, trackingClient } from '../services/supabase/trackingSync';
import {
  emptyGuestState,
  isGuestFresh,
  markGuestFresh,
  readAccountEnvelope,
  readGuestSession,
  writeAccountEnvelope,
  writeGuestSession,
} from './accountStore';
import {
  adoptKeptEpisodes,
  applyQueue,
  emptyStamps,
  hasQueueWork,
  hasTrackingRecords,
  isCurrentScope,
  learnEpisodeMeta,
  mergeRemoteAndLocal,
  queueForSync,
  stateFromRemote,
} from './cloudState';
import {
  markNextReleased,
  markSeasonUnwatched,
  markSeasonWatched,
  toggleReleasedEpisode,
  undoEpisodeChanges,
} from './progress';
import { listEpisodes, watchedThroughIds } from './status';
import {
  applyEpisodeRating,
  applyMovieChanges,
  applyMovieRating,
  applyMovieWatchlistToggle,
  applyShowIntent,
  applyShowRating,
  applyShowWatchlistToggle,
  removeTrackedShow,
  showEntry,
} from './watchlist';

const TrackingContext = createContext(null);

function episodeLookup(state, episodeId) {
  const showIds = new Set(Object.keys(state.shows || {}));
  Object.values(state.keptEpisodes || {}).forEach((episode) => {
    if (episode?.showId) {
      showIds.add(episode.showId);
    }
  });
  for (const showId of showIds) {
    const match = listEpisodes(getShow(showId)).find((episode) => episode.id === episodeId);
    if (match) {
      return { showId, season: match.season, number: match.number };
    }
  }
  return null;
}

function rehydrateCatalog(state) {
  const showIds = new Set([
    ...Object.keys(state.shows || {}),
    ...Object.keys(state.showRatings || {}),
    ...Object.values(state.keptEpisodes || {}).map((episode) => episode.showId),
  ]);
  showIds.forEach((id) => {
    const traktId = parseTraktShowKey(id);
    if (!traktId || getShow(id)) {
      return;
    }
    hydrateShow(traktId).then((show) => {
      if (show) {
        rememberShow(show);
      }
    }).catch(() => {});
  });
  Object.keys(state.movies || {}).forEach((id) => {
    const traktId = parseTraktMovieKey(id);
    if (!traktId || getMovie(id)) {
      return;
    }
    hydrateMovie(traktId).then((movie) => {
      if (movie) {
        rememberMovie(movie);
      }
    }).catch(() => {});
  });
}

function emptyState() {
  return {
    onboardingComplete: false,
    demoMode: false,
    shows: {},
    movies: {},
    showRatings: {},
    episodeRatings: {},
  };
}

export function TrackingProvider({ children }) {
  const { ready: authReady, session } = useAuth();
  const userId = session?.user?.id || null;
  const scopeKey = authReady ? (userId || 'guest') : null;
  const [appliedKey, setAppliedKey] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(emptyState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cacheRestored, setCacheRestored] = useState(false);
  const [syncStatus, setSyncStatus] = useState('saved');
  const [undo, setUndo] = useState(null);
  const undoRef = useRef(null);
  const serverRef = useRef(emptyState());
  const stampsRef = useRef(emptyStamps());
  const scopeRef = useRef({ id: 0, key: null });
  const flushRef = useRef(false);
  const readyRef = useRef(false);
  const userRef = useRef(null);
  const stateRef = useRef(emptyState());
  const flushImpl = useRef(async () => {});
  const previousUserRef = useRef(undefined);
  const guestFreshRef = useRef(false);

  if (scopeKey !== appliedKey) {
    setAppliedKey(scopeKey);
    setReady(false);
    setState(emptyState());
    setLoadError(false);
    setCacheRestored(false);
    setSyncStatus('saved');
    setUndo(null);
  }

  const updateUndo = useCallback((value) => {
    undoRef.current = value;
    setUndo(value);
  }, []);

  const commit = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return learnEpisodeMeta(adoptKeptEpisodes(next), episodeLookup);
    });
  }, []);

  useEffect(() => {
    readyRef.current = ready;
    userRef.current = userId;
    stateRef.current = state;
    undoRef.current = undo;
  }, [ready, state, undo, userId]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    if (previousUserRef.current && !userId) {
      guestFreshRef.current = true;
      markGuestFresh(AsyncStorage).catch(() => {});
    }
    previousUserRef.current = userId;
  }, [authReady, userId]);

  useEffect(() => {
    flushImpl.current = async (request) => {
      if (!userId || flushRef.current || !readyRef.current) {
        return;
      }
      const current = stateRef.current;
      const queue = queueForSync(serverRef.current, current, episodeLookup, { allowPush: !current.demoMode });
      if (!hasQueueWork(queue)) {
        setSyncStatus('saved');
        return;
      }
      if (queue.blocked.length && !Object.keys(queue.media).length && !Object.keys(queue.episodes).length) {
        setSyncStatus('error');
        return;
      }
      const supabase = trackingClient();
      if (!supabase) {
        setSyncStatus('error');
        return;
      }
      flushRef.current = true;
      setSyncStatus('saving');
      try {
        const result = await pushTracking(supabase, userId, queue, stampsRef.current);
        if (!isCurrentScope(scopeRef.current, request)) {
          return;
        }
        const ackedQueue = { media: {}, episodes: {}, blocked: [] };
        result.acked.media.forEach((id) => {
          if (queue.media[id]) {
            ackedQueue.media[id] = queue.media[id];
          }
        });
        result.acked.episodes.forEach((id) => {
          if (queue.episodes[id]) {
            ackedQueue.episodes[id] = queue.episodes[id];
          }
        });
        serverRef.current = applyQueue(serverRef.current, ackedQueue);
        const stamps = {
          media: { ...stampsRef.current.media, ...result.stamps.media },
          episodes: { ...stampsRef.current.episodes, ...result.stamps.episodes },
        };
        result.removed.media.forEach((id) => {
          delete stamps.media[id];
        });
        result.removed.episodes.forEach((id) => {
          delete stamps.episodes[id];
        });
        stampsRef.current = stamps;
        setSyncStatus(result.conflicts.length || queue.blocked.length ? 'error' : 'saved');
      } catch {
        if (isCurrentScope(scopeRef.current, request)) {
          setSyncStatus('error');
        }
      } finally {
        flushRef.current = false;
        if (isCurrentScope(scopeRef.current, request) && stateRef.current !== current) {
          flushImpl.current(request);
        }
      }
    };
  }, [userId]);

  useEffect(() => {
    if (!appliedKey) {
      return undefined;
    }
    const request = { id: scopeRef.current.id + 1, key: appliedKey };
    scopeRef.current = request;
    let active = true;
    (async () => {
      try {
        if (appliedKey === 'guest') {
          const fresh = guestFreshRef.current || await isGuestFresh(AsyncStorage);
          guestFreshRef.current = fresh;
          const guest = fresh ? emptyGuestState() : await readGuestSession(AsyncStorage);
          if (!active || !isCurrentScope(scopeRef.current, request)) {
            return;
          }
          serverRef.current = guest;
          stampsRef.current = emptyStamps();
          setState(guest);
          setCacheRestored(true);
          setLoadError(false);
          setReady(true);
          return;
        }
        const cache = await readAccountEnvelope(AsyncStorage, userId);
        const supabase = trackingClient();
        if (!supabase) {
          throw new Error('config');
        }
        const remoteRows = await pullTracking(supabase);
        if (!active || !isCurrentScope(scopeRef.current, request) || remoteRows.userId !== userId) {
          return;
        }
        const remote = stateFromRemote(remoteRows.media, remoteRows.episodes);
        const merged = mergeRemoteAndLocal(remote, cache, episodeLookup);
        serverRef.current = merged.server;
        stampsRef.current = merged.stamps;
        setState(merged.state);
        setCacheRestored(true);
        setLoadError(false);
        setReady(true);
        rehydrateCatalog(merged.state);
      } catch {
        if (!active || !isCurrentScope(scopeRef.current, request)) {
          return;
        }
        if (appliedKey !== 'guest' && userId) {
          try {
            const cache = await readAccountEnvelope(AsyncStorage, userId);
            if (!active || !isCurrentScope(scopeRef.current, request)) {
              return;
            }
            if (cache) {
              serverRef.current = cache.server;
              stampsRef.current = cache.stamps;
              setState(cache.state);
              setCacheRestored(true);
              setLoadError(false);
              setSyncStatus('error');
              setReady(true);
              rehydrateCatalog(cache.state);
              return;
            }
          } catch {
            // The account cache is unreadable. Keep the error screen.
          }
        }
        serverRef.current = emptyState();
        stampsRef.current = emptyStamps();
        setState(emptyState());
        setCacheRestored(false);
        setLoadError(true);
        setSyncStatus('error');
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [appliedKey, attempt, userId]);

  useEffect(() => {
    if (!ready || scopeRef.current.key !== appliedKey || (loadError && !cacheRestored)) {
      return;
    }
    if (appliedKey === 'guest') {
      if (guestFreshRef.current && !hasTrackingRecords(state) && !state.onboardingComplete) {
        return;
      }
      writeGuestSession(AsyncStorage, state).then((result) => {
        if (result?.wrote) {
          guestFreshRef.current = false;
        }
      }).catch(() => {});
      return;
    }
    if (!userId || state.demoMode) {
      return;
    }
    const request = scopeRef.current;
    writeAccountEnvelope(AsyncStorage, userId, {
      state,
      server: serverRef.current,
      stamps: stampsRef.current,
    }).catch(() => {});
    flushImpl.current(request);
  }, [appliedKey, cacheRestored, loadError, ready, state, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !readyRef.current || !userRef.current) {
        return;
      }
      flushImpl.current(scopeRef.current);
    });
    return () => subscription.remove();
  }, []);

  const dismissUndo = useCallback(() => {
    updateUndo(null);
  }, [updateUndo]);

  const undoLast = useCallback(() => {
    const current = undoRef.current;
    if (!current) {
      return;
    }
    updateUndo(null);
    commit((prev) => {
      if (current.created) {
        if (!prev.shows[current.showId]) {
          return prev;
        }
        const shows = { ...prev.shows };
        delete shows[current.showId];
        return { ...prev, shows };
      }
      const entry = prev.shows[current.showId];
      if (!entry) {
        return prev;
      }
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [current.showId]: undoEpisodeChanges(entry, {
            added: current.added || (current.episodeId ? [current.episodeId] : []),
            removed: current.removed || [],
            previousIntent: current.previousIntent,
          }),
        },
      };
    });
  }, [commit, updateUndo]);

  const markNextWatched = useCallback((showId) => {
    const show = getShow(showId);
    if (!show) {
      return;
    }
    let marked = null;
    commit((prev) => {
      const result = markNextReleased(show, prev.shows[showId]);
      if (!result.marked) {
        return prev;
      }
      marked = result;
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      };
    });
    if (marked) {
      updateUndo({
        showId,
        episodeId: marked.marked.id,
        added: marked.added,
        previousIntent: marked.previousIntent,
        episodeTitle: marked.marked.title || '',
        episodeTitleKey: marked.marked.titleKey,
      });
    }
  }, [commit, updateUndo]);

  const toggleEpisode = useCallback((showId, episodeId) => {
    const show = getShow(showId);
    if (!show) {
      return;
    }
    let marked = null;
    commit((prev) => {
      const existing = prev.shows[showId];
      const result = toggleReleasedEpisode(show, existing, episodeId);
      if (!result.added.length && !result.removed.length) {
        return prev;
      }
      if (result.marked) {
        marked = { ...result, created: !existing, previousIntent: existing?.intent || null };
      }
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      };
    });
    if (marked) {
      updateUndo({
        showId,
        episodeId: marked.marked.id,
        added: marked.added,
        removed: marked.removed,
        previousIntent: marked.previousIntent,
        created: marked.created,
        episodeTitle: marked.marked.title || '',
        episodeTitleKey: marked.marked.titleKey,
      });
    } else {
      updateUndo(null);
    }
  }, [commit, updateUndo]);

  const setSeasonWatched = useCallback((showId, seasonNumber, watched = true) => {
    const show = getShow(showId);
    if (!show || !Number.isInteger(seasonNumber)) {
      return;
    }
    let result = null;
    commit((prev) => {
      const existing = prev.shows[showId];
      result = watched
        ? markSeasonWatched(show, existing, seasonNumber)
        : markSeasonUnwatched(show, existing, seasonNumber);
      if (!result.added.length && !result.removed.length) {
        result = null;
        return prev;
      }
      return {
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      };
    });
    if (result) {
      updateUndo({
        kind: 'season',
        showId,
        seasonNumber,
        added: result.added,
        removed: result.removed,
        previousIntent: result.previousIntent,
        created: result.created,
        episodeTitle: '',
      });
    } else {
      updateUndo(null);
    }
  }, [commit, updateUndo]);

  const setShowIntent = useCallback((showId, intent) => {
    if (!getShow(showId)) {
      return;
    }
    updateUndo(null);
    commit((prev) => applyShowIntent(prev, showId, intent));
  }, [commit, updateUndo]);

  const removeShow = useCallback((showId) => {
    updateUndo(null);
    commit((prev) => removeTrackedShow(prev, showId));
  }, [commit, updateUndo]);

  const toggleShowWatchlist = useCallback((showId) => {
    if (!getShow(showId)) {
      return;
    }
    updateUndo(null);
    commit((prev) => applyShowWatchlistToggle(prev, showId));
  }, [commit, updateUndo]);

  const toggleMovieWatchlist = useCallback((movieId) => {
    if (!getMovie(movieId)) {
      return;
    }
    commit((prev) => applyMovieWatchlistToggle(prev, movieId));
  }, [commit]);

  const setShowRating = useCallback((showId, rating) => {
    if (!getShow(showId)) {
      return;
    }
    commit((prev) => applyShowRating(prev, showId, rating));
  }, [commit]);

  const setEpisodeRating = useCallback((episodeId, rating) => {
    if (!episodeId) {
      return;
    }
    commit((prev) => applyEpisodeRating(prev, episodeId, rating));
  }, [commit]);

  const saveMovie = useCallback((movieId, changes) => {
    if (!getMovie(movieId)) {
      return;
    }
    commit((prev) => applyMovieChanges(prev, movieId, changes));
  }, [commit]);

  const removeMovie = useCallback((movieId) => {
    commit((prev) => {
      if (!prev.movies[movieId]) {
        return prev;
      }
      const movies = { ...prev.movies };
      delete movies[movieId];
      return { ...prev, movies };
    });
  }, [commit]);

  const setMovieRating = useCallback((movieId, rating) => {
    if (!getMovie(movieId)) {
      return;
    }
    commit((prev) => applyMovieRating(prev, movieId, rating));
  }, [commit]);

  const completeOnboarding = useCallback(({ shows: selectedShows = [], movies: selectedMovies = [] }) => {
    updateUndo(null);
    commit((prev) => {
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
        movies[movieId] = {
          saved: true,
          watched: false,
          rating: existing?.rating ?? null,
        };
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
  }, [commit, updateUndo]);

  const loadDemo = useCallback(() => {
    updateUndo(null);
    commit({
      onboardingComplete: true,
      demoMode: true,
      shows: demoTracking.shows,
      movies: demoTracking.movies,
      showRatings: {},
      episodeRatings: demoTracking.episodeRatings || {},
    });
  }, [commit, updateUndo]);

  const clearLocalData = useCallback(() => {
    updateUndo(null);
    commit({
      onboardingComplete: true,
      demoMode: false,
      shows: {},
      movies: {},
      showRatings: {},
      episodeRatings: {},
    });
  }, [commit, updateUndo]);

  const restartOnboarding = useCallback(() => {
    updateUndo(null);
    commit((prev) => ({ ...prev, onboardingComplete: false }));
  }, [commit, updateUndo]);

  const retryLoad = useCallback(() => {
    setReady(false);
    setLoadError(false);
    setAttempt((current) => current + 1);
  }, []);

  const retrySync = useCallback(() => {
    flushImpl.current(scopeRef.current);
  }, []);

  const value = useMemo(() => ({
    ready,
    loadError,
    cacheRestored,
    syncStatus,
    retryLoad,
    retrySync,
    onboardingComplete: state.onboardingComplete,
    demoMode: state.demoMode,
    shows: state.shows,
    movies: state.movies,
    showRatings: state.showRatings,
    episodeRatings: state.episodeRatings,
    undo,
    dismissUndo,
    undoLast,
    markNextWatched,
    toggleEpisode,
    setSeasonWatched,
    setShowIntent,
    removeShow,
    setShowRating,
    setEpisodeRating,
    toggleShowWatchlist,
    toggleMovieWatchlist,
    saveMovie,
    removeMovie,
    setMovieRating,
    completeOnboarding,
    loadDemo,
    clearLocalData,
    restartOnboarding,
  }), [
    ready,
    loadError,
    cacheRestored,
    syncStatus,
    retryLoad,
    retrySync,
    state,
    undo,
    dismissUndo,
    undoLast,
    markNextWatched,
    toggleEpisode,
    setSeasonWatched,
    setShowIntent,
    removeShow,
    setShowRating,
    setEpisodeRating,
    toggleShowWatchlist,
    toggleMovieWatchlist,
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
