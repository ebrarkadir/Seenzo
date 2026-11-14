import { normalizeTracking } from './watchlist';

const SHOW_ID = /^trakt-show-[0-9]+$/;
const MOVIE_ID = /^trakt-movie-[0-9]+$/;
const EPISODE_ID = /^trakt-episode-[0-9]+$/;

export function isCloudShowId(id) {
  return SHOW_ID.test(String(id || ''));
}

export function isCloudMovieId(id) {
  return MOVIE_ID.test(String(id || ''));
}

export function isCloudEpisodeId(id) {
  return EPISODE_ID.test(String(id || ''));
}

export function emptyStamps() {
  return { media: {}, episodes: {} };
}

export function isCurrentScope(active, request) {
  return Boolean(active && request) && active.id === request.id && active.key === request.key;
}

export function hasTrackingRecords(state) {
  const value = state || {};
  return Object.keys(value.shows || {}).length > 0
    || Object.keys(value.movies || {}).length > 0
    || Object.keys(value.showRatings || {}).length > 0
    || Object.keys(value.episodeRatings || {}).length > 0
    || Object.keys(value.keptEpisodes || {}).length > 0;
}

export function hasQueueWork(queue) {
  if (!queue) {
    return false;
  }
  return Object.keys(queue.media || {}).length > 0
    || Object.keys(queue.episodes || {}).length > 0
    || (queue.blocked || []).length > 0;
}

function cloneState(state) {
  return normalizeTracking(JSON.parse(JSON.stringify(state)));
}

function mediaRow(state, id) {
  if (isCloudShowId(id)) {
    const entry = state.shows?.[id];
    const parked = state.showRatings?.[id];
    if (!entry && parked == null) {
      return null;
    }
    const intent = entry?.intent || null;
    const rating = entry ? entry.rating ?? null : parked ?? null;
    if (!intent && rating == null) {
      return null;
    }
    if (intent && intent !== 'plan' && intent !== 'watching' && intent !== 'dropped') {
      return null;
    }
    return {
      media_type: 'show',
      provider: 'trakt',
      media_id: id,
      show_intent: intent,
      movie_saved: null,
      movie_watched: null,
      rating,
    };
  }
  if (isCloudMovieId(id)) {
    const entry = state.movies?.[id];
    if (!entry || (!entry.saved && !entry.watched && entry.rating == null)) {
      return null;
    }
    return {
      media_type: 'movie',
      provider: 'trakt',
      media_id: id,
      show_intent: null,
      movie_saved: Boolean(entry.saved),
      movie_watched: Boolean(entry.watched),
      rating: entry.rating ?? null,
    };
  }
  return null;
}

function sameMedia(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.media_type === right.media_type
    && left.media_id === right.media_id
    && left.show_intent === right.show_intent
    && left.movie_saved === right.movie_saved
    && left.movie_watched === right.movie_watched
    && left.rating === right.rating;
}

function metaFor(state, episodeId, lookup) {
  const stored = state.episodeMeta?.[episodeId];
  if (stored && isCloudShowId(stored.showId) && Number.isInteger(stored.season) && Number.isInteger(stored.number)) {
    return stored;
  }
  const kept = state.keptEpisodes?.[episodeId];
  if (kept && isCloudShowId(kept.showId) && Number.isInteger(kept.season) && Number.isInteger(kept.number)) {
    return kept;
  }
  const found = lookup ? lookup(state, episodeId) : null;
  if (found && isCloudShowId(found.showId) && Number.isInteger(found.season) && found.season >= 0 && Number.isInteger(found.number) && found.number >= 1) {
    return found;
  }
  return null;
}

function episodeIds(state) {
  const ids = new Set();
  Object.entries(state.shows || {}).forEach(([showId, entry]) => {
    if (!isCloudShowId(showId)) {
      return;
    }
    (entry.watchedEpisodeIds || []).forEach((id) => {
      if (isCloudEpisodeId(id)) {
        ids.add(id);
      }
    });
  });
  Object.keys(state.episodeRatings || {}).forEach((id) => {
    if (isCloudEpisodeId(id)) {
      ids.add(id);
    }
  });
  Object.keys(state.keptEpisodes || {}).forEach((id) => {
    if (isCloudEpisodeId(id)) {
      ids.add(id);
    }
  });
  return ids;
}

function episodeRow(state, episodeId, lookup) {
  const meta = metaFor(state, episodeId, lookup);
  if (!meta) {
    const mentioned = state.episodeRatings?.[episodeId] != null
      || Object.values(state.shows || {}).some((entry) => (entry.watchedEpisodeIds || []).includes(episodeId))
      || state.keptEpisodes?.[episodeId];
    return mentioned ? { blocked: true } : null;
  }
  const tracked = state.shows?.[meta.showId];
  const kept = state.keptEpisodes?.[episodeId];
  const watched = Boolean(tracked?.watchedEpisodeIds?.includes(episodeId) || kept?.watched);
  const rating = state.episodeRatings?.[episodeId] ?? null;
  if (!watched && rating == null) {
    return null;
  }
  return {
    show_media_id: meta.showId,
    episode_id: episodeId,
    season_number: meta.season,
    episode_number: meta.number,
    watched,
    rating,
    watched_at: watched ? (storedWatchedAt(state, episodeId) || null) : null,
  };
}

function storedWatchedAt(state, episodeId) {
  return state.episodeMeta?.[episodeId]?.watchedAt || state.keptEpisodes?.[episodeId]?.watchedAt || null;
}

function sameEpisode(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.blocked || right.blocked) {
    return false;
  }
  return left.show_media_id === right.show_media_id
    && left.episode_id === right.episode_id
    && left.season_number === right.season_number
    && left.episode_number === right.episode_number
    && left.watched === right.watched
    && left.rating === right.rating;
}

function withWatchedAt(before, after) {
  if (!after?.watched) {
    return { ...after, watched_at: null };
  }
  return { ...after, watched_at: after.watched_at || before?.watched_at || new Date().toISOString() };
}

export function learnEpisodeMeta(state, lookup, now = () => new Date().toISOString()) {
  const episodeMeta = { ...(state.episodeMeta || {}) };
  let changed = false;
  episodeIds(state).forEach((episodeId) => {
    const meta = metaFor(state, episodeId, lookup);
    if (!meta) {
      return;
    }
    const watched = Boolean(state.shows?.[meta.showId]?.watchedEpisodeIds?.includes(episodeId) || state.keptEpisodes?.[episodeId]?.watched);
    const watchedAt = episodeMeta[episodeId]?.watchedAt || (watched ? now() : null);
    const next = {
      showId: meta.showId,
      season: meta.season,
      number: meta.number,
      watchedAt: watched ? watchedAt : null,
    };
    const current = episodeMeta[episodeId];
    if (!current || current.showId !== next.showId || current.season !== next.season || current.number !== next.number || current.watchedAt !== next.watchedAt) {
      episodeMeta[episodeId] = next;
      changed = true;
    }
  });
  if (!changed) {
    return state;
  }
  return { ...state, episodeMeta };
}

export function adoptKeptEpisodes(state) {
  let changed = false;
  const shows = { ...(state.shows || {}) };
  const keptEpisodes = { ...(state.keptEpisodes || {}) };
  Object.entries(keptEpisodes).forEach(([episodeId, episode]) => {
    const show = shows[episode.showId];
    if (!show || !episode.watched) {
      return;
    }
    if (!show.watchedEpisodeIds.includes(episodeId)) {
      shows[episode.showId] = {
        ...show,
        watchedEpisodeIds: [...show.watchedEpisodeIds, episodeId],
      };
    }
    delete keptEpisodes[episodeId];
    changed = true;
  });
  if (!changed) {
    return state;
  }
  return { ...state, shows, keptEpisodes };
}

export function planQueue(server, local, lookup) {
  const media = {};
  const episodes = {};
  const blocked = [];
  const mediaIds = new Set([
    ...Object.keys(server.shows || {}),
    ...Object.keys(server.movies || {}),
    ...Object.keys(server.showRatings || {}),
    ...Object.keys(local.shows || {}),
    ...Object.keys(local.movies || {}),
    ...Object.keys(local.showRatings || {}),
  ]);
  mediaIds.forEach((id) => {
    if (!isCloudShowId(id) && !isCloudMovieId(id)) {
      return;
    }
    const before = mediaRow(server, id);
    const after = mediaRow(local, id);
    if (sameMedia(before, after)) {
      return;
    }
    media[id] = after ? { type: 'upsert', row: after } : { type: 'delete' };
  });
  const ids = new Set([...episodeIds(server), ...episodeIds(local)]);
  ids.forEach((id) => {
    const before = episodeRow(server, id, lookup);
    const after = episodeRow(local, id, lookup);
    if (after?.blocked || before?.blocked) {
      if (after?.blocked) {
        blocked.push(id);
      }
      return;
    }
    if (sameEpisode(before, after)) {
      return;
    }
    const showId = after?.show_media_id || before?.show_media_id;
    if (!after && before && server.shows?.[showId] && !local.shows?.[showId]) {
      return;
    }
    episodes[id] = after
      ? { type: 'upsert', row: withWatchedAt(before, after) }
      : { type: 'delete' };
  });
  return { media, episodes, blocked };
}

export function queueForSync(server, local, lookup, { allowPush = false } = {}) {
  if (!allowPush || local?.demoMode) {
    return { media: {}, episodes: {}, blocked: [] };
  }
  return planQueue(server, local, lookup);
}

export function applyQueue(base, queue) {
  const next = cloneState(base);
  Object.entries(queue?.media || {}).forEach(([id, op]) => {
    if (op.type === 'delete') {
      delete next.shows[id];
      delete next.movies[id];
      delete next.showRatings[id];
      return;
    }
    const row = op.row;
    if (row.media_type === 'show') {
      if (row.show_intent) {
        next.shows[id] = {
          intent: row.show_intent,
          watchedEpisodeIds: next.shows[id]?.watchedEpisodeIds || [],
          rating: row.rating ?? null,
        };
        delete next.showRatings[id];
      } else {
        delete next.shows[id];
        if (row.rating != null) {
          next.showRatings[id] = row.rating;
        }
      }
      return;
    }
    next.movies[id] = {
      saved: Boolean(row.movie_saved),
      watched: Boolean(row.movie_watched),
      rating: row.rating ?? null,
    };
  });
  Object.entries(queue?.episodes || {}).forEach(([id, op]) => {
    if (op.type === 'delete') {
      delete next.episodeRatings[id];
      delete next.keptEpisodes[id];
      Object.keys(next.shows).forEach((showId) => {
        next.shows[showId] = {
          ...next.shows[showId],
          watchedEpisodeIds: next.shows[showId].watchedEpisodeIds.filter((episodeId) => episodeId !== id),
        };
      });
      return;
    }
    const row = op.row;
    next.episodeMeta[id] = {
      showId: row.show_media_id,
      season: row.season_number,
      number: row.episode_number,
      watchedAt: row.watched_at || null,
    };
    if (row.rating == null) {
      delete next.episodeRatings[id];
    } else {
      next.episodeRatings[id] = row.rating;
    }
    if (next.shows[row.show_media_id]) {
      const ids = new Set(next.shows[row.show_media_id].watchedEpisodeIds);
      if (row.watched) {
        ids.add(id);
      } else {
        ids.delete(id);
      }
      next.shows[row.show_media_id] = {
        ...next.shows[row.show_media_id],
        watchedEpisodeIds: [...ids],
      };
      delete next.keptEpisodes[id];
      return;
    }
    next.keptEpisodes[id] = {
      showId: row.show_media_id,
      season: row.season_number,
      number: row.episode_number,
      watched: Boolean(row.watched),
      rating: row.rating ?? null,
      watchedAt: row.watched_at || null,
    };
  });
  return next;
}

export function stateFromRemote(mediaRows, episodeRows) {
  const state = normalizeTracking(null);
  const stamps = emptyStamps();
  (mediaRows || []).forEach((row) => {
    if (!row?.media_id) {
      return;
    }
    stamps.media[row.media_id] = row.updated_at || null;
    if (row.media_type === 'show' && isCloudShowId(row.media_id)) {
      if (row.show_intent === 'plan' || row.show_intent === 'watching' || row.show_intent === 'dropped') {
        state.shows[row.media_id] = {
          intent: row.show_intent,
          watchedEpisodeIds: [],
          rating: row.rating ?? null,
        };
      } else if (row.rating != null) {
        state.showRatings[row.media_id] = row.rating;
      }
      return;
    }
    if (row.media_type === 'movie' && isCloudMovieId(row.media_id)) {
      if (!row.movie_saved && !row.movie_watched && row.rating == null) {
        return;
      }
      state.movies[row.media_id] = {
        saved: Boolean(row.movie_saved),
        watched: Boolean(row.movie_watched),
        rating: row.rating ?? null,
      };
    }
  });
  (episodeRows || []).forEach((row) => {
    if (!isCloudEpisodeId(row?.episode_id) || !isCloudShowId(row?.show_media_id)) {
      return;
    }
    const season = Number(row.season_number);
    const number = Number(row.episode_number);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(number) || number < 1) {
      return;
    }
    stamps.episodes[row.episode_id] = row.updated_at || null;
    state.episodeMeta[row.episode_id] = {
      showId: row.show_media_id,
      season,
      number,
      watchedAt: row.watched_at || null,
    };
    if (row.rating != null) {
      state.episodeRatings[row.episode_id] = row.rating;
    }
    if (row.watched && state.shows[row.show_media_id]) {
      const entry = state.shows[row.show_media_id];
      if (!entry.watchedEpisodeIds.includes(row.episode_id)) {
        entry.watchedEpisodeIds = [...entry.watchedEpisodeIds, row.episode_id];
      }
      return;
    }
    if (row.watched || row.rating != null) {
      state.keptEpisodes[row.episode_id] = {
        showId: row.show_media_id,
        season,
        number,
        watched: Boolean(row.watched),
        rating: row.rating ?? null,
        watchedAt: row.watched_at || null,
      };
    }
  });
  return { state, stamps };
}

export function mergeRemoteAndLocal(remote, cache, lookup) {
  const remoteHasRows = hasTrackingRecords(remote.state);
  const onboardingComplete = cache ? Boolean(cache.state.onboardingComplete) : remoteHasRows;
  if (!cache) {
    const state = adoptKeptEpisodes({ ...remote.state, onboardingComplete, demoMode: false });
    return { state, server: { ...remote.state, onboardingComplete, demoMode: false }, stamps: remote.stamps || emptyStamps() };
  }
  const queue = planQueue(cache.server, cache.state, lookup);
  const state = adoptKeptEpisodes({
    ...applyQueue(remote.state, queue),
    onboardingComplete,
    demoMode: false,
  });
  (queue.blocked || []).forEach((episodeId) => {
    if (cache.state.episodeRatings?.[episodeId] != null) {
      state.episodeRatings[episodeId] = cache.state.episodeRatings[episodeId];
    }
    if (cache.state.episodeMeta?.[episodeId]) {
      state.episodeMeta[episodeId] = cache.state.episodeMeta[episodeId];
    }
  });
  return {
    state,
    server: { ...remote.state, onboardingComplete, demoMode: false },
    stamps: remote.stamps || emptyStamps(),
  };
}

function rowSignature(row) {
  if (!row) {
    return '';
  }
  return JSON.stringify([
    row.media_type || null,
    row.media_id || row.episode_id || null,
    row.show_intent ?? null,
    row.movie_saved ?? null,
    row.movie_watched ?? null,
    row.show_media_id || null,
    row.season_number ?? null,
    row.episode_number ?? null,
    row.watched ?? null,
    row.rating ?? null,
  ]);
}

export function classifyChange(stamp, remoteStamp, desired, remoteRow) {
  if (!remoteRow && !desired) {
    return 'ack';
  }
  if (remoteRow && desired && rowSignature(remoteRow) === rowSignature(desired)) {
    return 'ack';
  }
  if (!desired && remoteRow && stamp && remoteStamp && remoteStamp !== stamp) {
    return 'conflict';
  }
  if (desired && remoteRow && stamp && remoteStamp && remoteStamp !== stamp) {
    return 'conflict';
  }
  if (desired && remoteRow && !stamp) {
    return 'conflict';
  }
  return 'push';
}

export function remoteMediaSignature(row) {
  if (!row) {
    return null;
  }
  return {
    media_type: row.media_type,
    media_id: row.media_id,
    show_intent: row.show_intent ?? null,
    movie_saved: row.movie_saved ?? null,
    movie_watched: row.movie_watched ?? null,
    rating: row.rating ?? null,
  };
}

export function remoteEpisodeSignature(row) {
  if (!row) {
    return null;
  }
  return {
    episode_id: row.episode_id,
    show_media_id: row.show_media_id,
    season_number: row.season_number,
    episode_number: row.episode_number,
    watched: Boolean(row.watched),
    rating: row.rating ?? null,
  };
}
