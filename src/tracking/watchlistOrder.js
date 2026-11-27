/**
 * Persistent manual watchlist ordering (Movies To Watch + TV Plan).
 * Order arrays are independent of ratings/progress and never invent dates.
 */

export function emptyWatchlistOrderMeta() {
  return {
    movie: { revision: 0, dirty: false },
    show: { revision: 0, dirty: false },
  };
}

export function uniqueOrderIds(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    out.push(id);
  });
  return out;
}

export function movieWatchlistMemberIds(movies) {
  return Object.entries(movies || {})
    .filter(([, entry]) => entry?.saved && !entry?.watched)
    .map(([id]) => id);
}

export function showWatchlistMemberIds(shows) {
  return Object.entries(shows || {})
    .filter(([, entry]) => entry?.intent === 'plan')
    .map(([id]) => id);
}

/**
 * Keep known order, drop orphans/dupes, append missing members by stable id sort
 * (recovery only — intentional adds should use appendWatchlistId).
 */
export function reconcileOrderArray(order, memberIds) {
  const members = new Set(memberIds || []);
  const kept = [];
  const seen = new Set();
  uniqueOrderIds(order).forEach((id) => {
    if (!members.has(id) || seen.has(id)) {
      return;
    }
    seen.add(id);
    kept.push(id);
  });
  const missing = (memberIds || [])
    .filter((id) => id && !seen.has(id))
    .sort((left, right) => String(left).localeCompare(String(right)));
  return [...kept, ...missing];
}

export function appendWatchlistId(order, id) {
  const nextId = String(id || '').trim();
  if (!nextId) {
    return uniqueOrderIds(order);
  }
  const current = uniqueOrderIds(order);
  if (current.includes(nextId)) {
    return current;
  }
  return [...current, nextId];
}

export function removeWatchlistId(order, id) {
  const nextId = String(id || '').trim();
  if (!nextId) {
    return uniqueOrderIds(order);
  }
  return uniqueOrderIds(order).filter((item) => item !== nextId);
}

/**
 * Move id to 1-based position. Invalid targets return the original unique order.
 */
export function moveWatchlistId(order, id, toPosition) {
  const current = uniqueOrderIds(order);
  const nextId = String(id || '').trim();
  const index = current.indexOf(nextId);
  if (!nextId || index < 0) {
    return { order: current, ok: false, reason: 'missing' };
  }
  const n = current.length;
  const position = Number(toPosition);
  if (!Number.isInteger(position) || position < 1 || position > n) {
    return { order: current, ok: false, reason: 'invalid_position' };
  }
  if (position === index + 1) {
    return { order: current, ok: true, reason: null };
  }
  const without = current.filter((item) => item !== nextId);
  without.splice(position - 1, 0, nextId);
  return { order: without, ok: true, reason: null };
}

export function reorderWatchlistIds(order, nextOrder) {
  const current = uniqueOrderIds(order);
  const proposed = uniqueOrderIds(nextOrder);
  if (proposed.length !== current.length) {
    return { order: current, ok: false, reason: 'length' };
  }
  const currentSet = new Set(current);
  if (proposed.some((id) => !currentSet.has(id))) {
    return { order: current, ok: false, reason: 'membership' };
  }
  return { order: proposed, ok: true, reason: null };
}

export function markWatchlistOrderDirty(meta, mediaType) {
  const key = mediaType === 'show' ? 'show' : 'movie';
  const base = emptyWatchlistOrderMeta();
  const current = meta && typeof meta === 'object' ? meta : base;
  return {
    movie: { ...(base.movie), ...(current.movie || {}) },
    show: { ...(base.show), ...(current.show || {}) },
    [key]: {
      revision: Number(current[key]?.revision) || 0,
      dirty: true,
    },
  };
}

export function markWatchlistOrderClean(meta, mediaType, revision) {
  const key = mediaType === 'show' ? 'show' : 'movie';
  const base = emptyWatchlistOrderMeta();
  const current = meta && typeof meta === 'object' ? meta : base;
  return {
    movie: { ...(base.movie), ...(current.movie || {}) },
    show: { ...(base.show), ...(current.show || {}) },
    [key]: {
      revision: Number.isFinite(Number(revision)) ? Number(revision) : (Number(current[key]?.revision) || 0),
      dirty: false,
    },
  };
}

export function reconcileWatchlistOrders(state) {
  if (!state || typeof state !== 'object') {
    return state;
  }
  const movieMembers = movieWatchlistMemberIds(state.movies);
  const showMembers = showWatchlistMemberIds(state.shows);
  const movieWatchlistOrder = reconcileOrderArray(state.movieWatchlistOrder, movieMembers);
  const showWatchlistOrder = reconcileOrderArray(state.showWatchlistOrder, showMembers);
  const incoming = state.watchlistOrderMeta && typeof state.watchlistOrderMeta === 'object'
    ? state.watchlistOrderMeta
    : {};
  return {
    ...state,
    movieWatchlistOrder,
    showWatchlistOrder,
    watchlistOrderMeta: {
      movie: {
        revision: Number(incoming.movie?.revision) || 0,
        dirty: Boolean(incoming.movie?.dirty),
      },
      show: {
        revision: Number(incoming.show?.revision) || 0,
        dirty: Boolean(incoming.show?.dirty),
      },
    },
  };
}

export function applyMovieWatchlistOrderMove(prev, movieId, toPosition) {
  const base = reconcileWatchlistOrders(prev);
  const result = moveWatchlistId(base.movieWatchlistOrder, movieId, toPosition);
  if (!result.ok && result.reason !== null) {
    return { state: base, ok: false, reason: result.reason };
  }
  if (result.order === base.movieWatchlistOrder
    || (result.order.length === base.movieWatchlistOrder.length
      && result.order.every((id, index) => id === base.movieWatchlistOrder[index]))) {
    return { state: base, ok: true, reason: null };
  }
  return {
    state: {
      ...base,
      movieWatchlistOrder: result.order,
      watchlistOrderMeta: markWatchlistOrderDirty(base.watchlistOrderMeta, 'movie'),
    },
    ok: true,
    reason: null,
  };
}

export function applyShowWatchlistOrderMove(prev, showId, toPosition) {
  const base = reconcileWatchlistOrders(prev);
  const result = moveWatchlistId(base.showWatchlistOrder, showId, toPosition);
  if (!result.ok && result.reason !== null) {
    return { state: base, ok: false, reason: result.reason };
  }
  if (result.order.length === base.showWatchlistOrder.length
    && result.order.every((id, index) => id === base.showWatchlistOrder[index])) {
    return { state: base, ok: true, reason: null };
  }
  return {
    state: {
      ...base,
      showWatchlistOrder: result.order,
      watchlistOrderMeta: markWatchlistOrderDirty(base.watchlistOrderMeta, 'show'),
    },
    ok: true,
    reason: null,
  };
}

export function applyMovieWatchlistReorder(prev, nextOrder) {
  const base = reconcileWatchlistOrders(prev);
  const result = reorderWatchlistIds(base.movieWatchlistOrder, nextOrder);
  if (!result.ok) {
    return { state: base, ok: false, reason: result.reason };
  }
  if (result.order.every((id, index) => id === base.movieWatchlistOrder[index])) {
    return { state: base, ok: true, reason: null };
  }
  return {
    state: {
      ...base,
      movieWatchlistOrder: result.order,
      watchlistOrderMeta: markWatchlistOrderDirty(base.watchlistOrderMeta, 'movie'),
    },
    ok: true,
    reason: null,
  };
}

export function applyShowWatchlistReorder(prev, nextOrder) {
  const base = reconcileWatchlistOrders(prev);
  const result = reorderWatchlistIds(base.showWatchlistOrder, nextOrder);
  if (!result.ok) {
    return { state: base, ok: false, reason: result.reason };
  }
  if (result.order.every((id, index) => id === base.showWatchlistOrder[index])) {
    return { state: base, ok: true, reason: null };
  }
  return {
    state: {
      ...base,
      showWatchlistOrder: result.order,
      watchlistOrderMeta: markWatchlistOrderDirty(base.watchlistOrderMeta, 'show'),
    },
    ok: true,
    reason: null,
  };
}

export function orderIdsEqual(left, right) {
  const a = uniqueOrderIds(left);
  const b = uniqueOrderIds(right);
  if (a.length !== b.length) {
    return false;
  }
  return a.every((id, index) => id === b[index]);
}

export function sortItemsByWatchlistOrder(items, order, getId) {
  const rank = new Map(uniqueOrderIds(order).map((id, index) => [id, index]));
  return [...(items || [])].sort((left, right) => {
    const leftId = getId(left);
    const rightId = getId(right);
    const leftRank = rank.has(leftId) ? rank.get(leftId) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(rightId) ? rank.get(rightId) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return String(leftId || '').localeCompare(String(rightId || ''));
  });
}
