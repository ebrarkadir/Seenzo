import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../auth/AuthContext';
import { demoTracking } from '../data/demoTracking';
import { rememberMovie, rememberShow, resolveMovie as getMovie, resolveShow as getShow } from '../data/mediaLibrary';
import { startupLog } from '../diagnostics/startup';
import { parseTraktMovieKey, parseTraktShowKey } from '../services/trakt/normalize';
import { hydrateMovie, hydrateShow } from '../services/trakt/catalog';
import { publishSocialRatingEvent } from '../services/supabase/socialActivity';
import { pullTracking, pushActivityEvents, pushTracking, trackingClient } from '../services/supabase/trackingSync';
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
  acknowledgeActivityEvents,
  appendActivityEvents,
  buildEpisodeActivityEvents,
  buildMovieActivityEvents,
  pendingActivityEvents,
} from './activityEvents';
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
  markShowWatched,
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
  clampRating,
  isEpisodeWatched,
  removeTrackedShow,
  showEntry,
} from './watchlist';

const TrackingContext = createContext(null);
const ACCOUNT_LOAD_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, code = 'timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
    episodeMeta: {},
    keptEpisodes: {},
    activityEvents: [],
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
    // Reset to empty non-demo state immediately on account→guest so a stale
    // onboardingComplete flag cannot keep the signed-out user on tabs while
    // guest storage loads. guestFresh is marked in the userId effect below.
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
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[logout] tracking_scope_updated', {
          scope: 'guest',
          guestFresh: true,
          demoMode: false,
          onboardingComplete: false,
        });
      }
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
      const pendingActivity = !current.demoMode ? pendingActivityEvents(current) : [];
      if (!hasQueueWork(queue) && !pendingActivity.length) {
        setSyncStatus('saved');
        return;
      }
      if (
        queue.blocked.length
        && !Object.keys(queue.media).length
        && !Object.keys(queue.episodes).length
        && !pendingActivity.length
      ) {
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
        let conflicts = [];
        let blocked = queue.blocked || [];
        if (hasQueueWork(queue)) {
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
          const previousServer = serverRef.current;
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
          conflicts = result.conflicts || [];
          blocked = queue.blocked || [];

          // Backup social rating publish after cloud rating writes.
          // Covers first INSERT sync (UPDATE trigger does not fire) and RPC timing misses.
          if (!current.demoMode) {
            Object.entries(ackedQueue.media).forEach(([id, op]) => {
              if (op.type === 'delete') {
                return;
              }
              const row = op.row;
              if (!row) {
                return;
              }
              const previousRating = row.media_type === 'movie'
                ? previousServer?.movies?.[id]?.rating ?? null
                : (previousServer?.shows?.[id]?.rating ?? previousServer?.showRatings?.[id] ?? null);
              const nextRating = row.rating ?? null;
              if (previousRating === nextRating) {
                return;
              }
              if (row.media_type === 'movie') {
                void publishSocialRatingEvent({
                  activityType: 'movie_rated',
                  mediaId: id,
                  rating: nextRating,
                });
              } else if (row.media_type === 'show') {
                void publishSocialRatingEvent({
                  activityType: 'show_rated',
                  mediaId: id,
                  rating: nextRating,
                });
              }
            });
            Object.entries(ackedQueue.episodes).forEach(([id, op]) => {
              if (op.type === 'delete') {
                return;
              }
              const row = op.row;
              if (!row?.show_media_id) {
                return;
              }
              const previousRating = previousServer?.episodeRatings?.[id] ?? null;
              const nextRating = row.rating ?? null;
              if (previousRating === nextRating) {
                return;
              }
              void publishSocialRatingEvent({
                activityType: 'episode_rated',
                mediaId: id,
                showMediaId: row.show_media_id,
                seasonNumber: row.season_number,
                episodeNumber: row.episode_number,
                rating: nextRating,
              });
            });
          }
        }
        if (pendingActivity.length) {
          const activityResult = await pushActivityEvents(supabase, userId, current);
          if (!isCurrentScope(scopeRef.current, request)) {
            return;
          }
          if (activityResult.acked?.length) {
            setState((prev) => acknowledgeActivityEvents(prev, activityResult.acked));
          }
          // Missing activity table (migration not applied) must not block tracking sync.
        }
        setSyncStatus(conflicts.length || blocked.length ? 'error' : 'saved');
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
    startupLog('tracking_load_start', { scope: appliedKey === 'guest' ? 'guest' : 'account' });
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
          startupLog('tracking_ready', {
            scope: 'guest',
            onboardingComplete: Boolean(guest.onboardingComplete),
          });
          return;
        }
        const cache = await readAccountEnvelope(AsyncStorage, userId);
        const supabase = trackingClient();
        if (!supabase) {
          throw new Error('config');
        }
        const remoteRows = await withTimeout(pullTracking(supabase), ACCOUNT_LOAD_TIMEOUT_MS);
        if (!active || !isCurrentScope(scopeRef.current, request)) {
          return;
        }
        if (remoteRows.userId !== userId) {
          // Do not leave ready=false forever on an unexpected auth mismatch.
          throw new Error('auth');
        }
        const remote = stateFromRemote(remoteRows.media, remoteRows.episodes, remoteRows.activity);
        const merged = mergeRemoteAndLocal(remote, cache, episodeLookup);
        serverRef.current = merged.server;
        stampsRef.current = merged.stamps;
        setState(merged.state);
        setCacheRestored(true);
        setLoadError(false);
        setReady(true);
        startupLog('tracking_ready', {
          scope: 'account',
          onboardingComplete: Boolean(merged.state.onboardingComplete),
          cache: Boolean(cache),
        });
        rehydrateCatalog(merged.state);
      } catch (error) {
        if (!active || !isCurrentScope(scopeRef.current, request)) {
          return;
        }
        startupLog('tracking_load_error', { code: error?.code || error?.message || 'error' });
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
              startupLog('tracking_ready', {
                scope: 'account',
                onboardingComplete: Boolean(cache.state?.onboardingComplete),
                cacheFallback: true,
              });
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
        startupLog('tracking_ready', { scope: appliedKey === 'guest' ? 'guest' : 'account', loadError: true });
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
    const now = new Date().toISOString();
    const added = current.added || (current.episodeId ? [current.episodeId] : []);
    const removed = current.removed || [];
    const undoEvents = [
      ...buildEpisodeActivityEvents({
        showId: current.showId,
        episodeIds: added,
        action: 'unwatched',
        source: 'undo',
        now,
      }),
      ...buildEpisodeActivityEvents({
        showId: current.showId,
        episodeIds: removed,
        action: 'watched',
        source: 'undo',
        now,
      }),
    ];
    commit((prev) => {
      let next = prev;
      if (current.created) {
        if (!prev.shows[current.showId]) {
          return appendActivityEvents(prev, undoEvents);
        }
        const shows = { ...prev.shows };
        delete shows[current.showId];
        next = { ...prev, shows };
      } else {
        const entry = prev.shows[current.showId];
        if (!entry) {
          return appendActivityEvents(prev, undoEvents);
        }
        next = {
          ...prev,
          shows: {
            ...prev.shows,
            [current.showId]: undoEpisodeChanges(entry, {
              added,
              removed,
              previousIntent: current.previousIntent,
            }),
          },
        };
      }
      return appendActivityEvents(next, undoEvents);
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
      const now = new Date().toISOString();
      return appendActivityEvents({
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      }, buildEpisodeActivityEvents({
        showId,
        episodeIds: result.added || [result.marked.id],
        action: 'watched',
        source: 'individual',
        now,
      }));
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
      const now = new Date().toISOString();
      // Only the tapped episode stays `individual` (may publish to social feed).
      // Prior catch-up episodes use episode_catchup so social feed is not flooded.
      const primaryAdded = result.added.filter((id) => id === episodeId);
      const catchupAdded = result.added.filter((id) => id !== episodeId);
      const events = [
        ...buildEpisodeActivityEvents({
          showId,
          episodeIds: primaryAdded,
          action: 'watched',
          source: 'individual',
          now,
        }),
        ...buildEpisodeActivityEvents({
          showId,
          episodeIds: catchupAdded,
          action: 'watched',
          source: 'episode_catchup',
          now,
        }),
        ...buildEpisodeActivityEvents({
          showId,
          episodeIds: result.removed,
          action: 'unwatched',
          source: 'individual',
          now,
        }),
      ];
      return appendActivityEvents({
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      }, events);
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
      const now = new Date().toISOString();
      const events = [
        ...buildEpisodeActivityEvents({
          showId,
          episodeIds: result.added,
          action: 'watched',
          source: 'season_bulk',
          now,
        }),
        ...buildEpisodeActivityEvents({
          showId,
          episodeIds: result.removed,
          action: 'unwatched',
          source: 'season_bulk',
          now,
        }),
      ];
      return appendActivityEvents({
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      }, events);
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

  const setShowWatched = useCallback((showId) => {
    const show = getShow(showId);
    if (!show) {
      return;
    }
    let result = null;
    commit((prev) => {
      const existing = prev.shows[showId];
      result = markShowWatched(show, existing);
      if (!result.added.length) {
        result = null;
        return prev;
      }
      const now = new Date().toISOString();
      return appendActivityEvents({
        ...prev,
        shows: {
          ...prev.shows,
          [showId]: result.entry,
        },
      }, buildEpisodeActivityEvents({
        showId,
        episodeIds: result.added,
        action: 'watched',
        source: 'show_bulk',
        now,
      }));
    });
    if (result) {
      updateUndo({
        kind: 'show',
        showId,
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
    const nextRating = clampRating(rating);
    commit((prev) => applyShowRating(prev, showId, rating));
    if (!stateRef.current?.demoMode) {
      void publishSocialRatingEvent({
        activityType: 'show_rated',
        mediaId: showId,
        rating: nextRating,
      });
    }
  }, [commit]);

  const setEpisodeRating = useCallback((episodeId, rating) => {
    if (!episodeId) {
      return;
    }
    const before = stateRef.current;
    if (!isEpisodeWatched(before, episodeId)) {
      return;
    }
    const lookedUp = episodeLookup(before, episodeId);
    const kept = before?.keptEpisodes?.[episodeId] || null;
    const showMediaId = lookedUp?.showId || kept?.showId || null;
    const seasonNumber = lookedUp?.season ?? kept?.season ?? null;
    const episodeNumber = lookedUp?.number ?? kept?.number ?? null;
    const nextRating = clampRating(rating);
    commit((prev) => applyEpisodeRating(prev, episodeId, rating));
    if (!stateRef.current?.demoMode && showMediaId) {
      void publishSocialRatingEvent({
        activityType: 'episode_rated',
        mediaId: episodeId,
        showMediaId,
        seasonNumber,
        episodeNumber,
        rating: nextRating,
      });
    }
  }, [commit]);

  const saveMovie = useCallback((movieId, changes) => {
    if (!getMovie(movieId)) {
      return;
    }
    commit((prev) => {
      const watchedBefore = Boolean(prev.movies?.[movieId]?.watched);
      const next = applyMovieChanges(prev, movieId, changes);
      const watchedAfter = Boolean(next.movies?.[movieId]?.watched);
      return appendActivityEvents(
        next,
        buildMovieActivityEvents(movieId, {
          watchedBefore,
          watchedAfter,
          now: new Date().toISOString(),
        })
      );
    });
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
    if (!stateRef.current?.movies?.[movieId]?.watched) {
      return;
    }
    const nextRating = clampRating(rating);
    commit((prev) => applyMovieRating(prev, movieId, rating));
    if (!stateRef.current?.demoMode) {
      void publishSocialRatingEvent({
        activityType: 'movie_rated',
        mediaId: movieId,
        rating: nextRating,
      });
    }
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
      episodeMeta: {},
      keptEpisodes: {},
      activityEvents: [],
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
      episodeMeta: {},
      keptEpisodes: {},
      activityEvents: [],
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
    episodeMeta: state.episodeMeta,
    keptEpisodes: state.keptEpisodes,
    activityEvents: state.activityEvents,
    undo,
    dismissUndo,
    undoLast,
    markNextWatched,
    toggleEpisode,
    setSeasonWatched,
    setShowWatched,
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
    setShowWatched,
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
