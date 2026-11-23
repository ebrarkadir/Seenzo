const ACTIVITY_MOVIE_ID = /^trakt-movie-[0-9]+$/;
const ACTIVITY_EPISODE_ID = /^trakt-episode-[0-9]+$/;
const ACTIVITY_SHOW_ID = /^trakt-show-[0-9]+$/;
const ACTIVITY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set(['watched', 'unwatched']);
const SOURCES = new Set(['individual', 'season_bulk', 'show_bulk', 'undo']);
const MEDIA_TYPES = new Set(['movie', 'episode']);

export function createClientEventId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

export function createActivityEvent({
  mediaType,
  mediaId,
  showMediaId = null,
  action,
  source,
  clientLoggedAt = new Date().toISOString(),
  clientEventId = createClientEventId(),
  serverRecordedAt = null,
} = {}) {
  if (!MEDIA_TYPES.has(mediaType) || !ACTIONS.has(action) || !SOURCES.has(source)) {
    return null;
  }
  if (mediaType === 'movie') {
    if (!ACTIVITY_MOVIE_ID.test(mediaId) || showMediaId) {
      return null;
    }
  } else if (!ACTIVITY_EPISODE_ID.test(mediaId) || !ACTIVITY_SHOW_ID.test(showMediaId || '')) {
    return null;
  }
  if (typeof clientLoggedAt !== 'string' || !clientLoggedAt) {
    return null;
  }
  return {
    clientEventId,
    mediaType,
    mediaId,
    showMediaId: mediaType === 'episode' ? showMediaId : null,
    action,
    source,
    clientLoggedAt,
    serverRecordedAt: typeof serverRecordedAt === 'string' ? serverRecordedAt : null,
  };
}

export function normalizeActivityEvents(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const byId = new Map();
  value.forEach((entry) => {
    if (!entry?.clientEventId || !ACTIVITY_UUID.test(entry.clientEventId)) {
      return;
    }
    const event = createActivityEvent({
      mediaType: entry?.mediaType,
      mediaId: entry?.mediaId,
      showMediaId: entry?.showMediaId ?? null,
      action: entry?.action,
      source: entry?.source,
      clientLoggedAt: entry?.clientLoggedAt,
      clientEventId: entry.clientEventId,
      serverRecordedAt: entry?.serverRecordedAt ?? null,
    });
    if (!event) {
      return;
    }
    const existing = byId.get(event.clientEventId);
    if (!existing) {
      byId.set(event.clientEventId, event);
      return;
    }
    byId.set(event.clientEventId, {
      ...existing,
      ...event,
      serverRecordedAt: event.serverRecordedAt || existing.serverRecordedAt || null,
    });
  });
  return [...byId.values()].sort((left, right) => {
    const leftAt = left.serverRecordedAt || left.clientLoggedAt;
    const rightAt = right.serverRecordedAt || right.clientLoggedAt;
    return leftAt.localeCompare(rightAt) || left.clientEventId.localeCompare(right.clientEventId);
  });
}

export function appendActivityEvents(state, events) {
  const nextEvents = normalizeActivityEvents([
    ...(state?.activityEvents || []),
    ...(events || []),
  ]);
  if (nextEvents.length === (state?.activityEvents || []).length) {
    const before = new Set((state?.activityEvents || []).map((item) => item.clientEventId));
    if (nextEvents.every((item) => before.has(item.clientEventId))) {
      return state;
    }
  }
  return {
    ...state,
    activityEvents: nextEvents,
  };
}

export function mergeActivityEvents(remoteEvents, localEvents) {
  return normalizeActivityEvents([...(remoteEvents || []), ...(localEvents || [])]);
}

export function pendingActivityEvents(state) {
  return normalizeActivityEvents(state?.activityEvents).filter((event) => !event.serverRecordedAt);
}

export function acknowledgeActivityEvents(state, acks) {
  if (!acks?.length) {
    return state;
  }
  const byId = new Map(
    (acks || [])
      .filter((row) => row?.clientEventId && row?.serverRecordedAt)
      .map((row) => [row.clientEventId, row.serverRecordedAt])
  );
  if (!byId.size) {
    return state;
  }
  const activityEvents = normalizeActivityEvents(state?.activityEvents).map((event) => {
    const recorded = byId.get(event.clientEventId);
    if (!recorded) {
      return event;
    }
    return { ...event, serverRecordedAt: event.serverRecordedAt || recorded };
  });
  return { ...state, activityEvents };
}

export function isChartEligibleActivity(event) {
  return event?.action === 'watched' && event?.source === 'individual';
}

export function activityEventsFromRemoteRows(rows) {
  return normalizeActivityEvents((rows || []).map((row) => ({
    clientEventId: row.client_event_id,
    mediaType: row.media_type,
    mediaId: row.media_id,
    showMediaId: row.show_media_id,
    action: row.action,
    source: row.source,
    clientLoggedAt: row.client_logged_at,
    serverRecordedAt: row.server_recorded_at || null,
  })));
}

export function activityRowFromEvent(event, userId) {
  if (!event || !userId) {
    return null;
  }
  return {
    user_id: userId,
    client_event_id: event.clientEventId,
    media_type: event.mediaType,
    media_id: event.mediaId,
    show_media_id: event.showMediaId,
    action: event.action,
    source: event.source,
    client_logged_at: event.clientLoggedAt,
  };
}

export function buildMovieActivityEvents(movieId, { watchedBefore, watchedAfter, now }) {
  if (!ACTIVITY_MOVIE_ID.test(movieId) || Boolean(watchedBefore) === Boolean(watchedAfter)) {
    return [];
  }
  const event = createActivityEvent({
    mediaType: 'movie',
    mediaId: movieId,
    action: watchedAfter ? 'watched' : 'unwatched',
    source: 'individual',
    clientLoggedAt: now || new Date().toISOString(),
  });
  return event ? [event] : [];
}

export function buildEpisodeActivityEvents({
  showId,
  episodeIds = [],
  action,
  source,
  now,
}) {
  if (!ACTIVITY_SHOW_ID.test(showId) || !ACTIONS.has(action) || !SOURCES.has(source)) {
    return [];
  }
  const stamped = now || new Date().toISOString();
  return episodeIds
    .map((episodeId) => createActivityEvent({
      mediaType: 'episode',
      mediaId: episodeId,
      showMediaId: showId,
      action,
      source,
      clientLoggedAt: stamped,
    }))
    .filter(Boolean);
}
