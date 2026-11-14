import { getNextEpisode, isReleased, listEpisodes, releasedEpisodes, seasonReleasedEpisodes } from './status';

function uniqueIds(ids) {
  const seen = new Set();
  const next = [];
  (ids || []).forEach((id) => {
    if (typeof id !== 'string' || !id || seen.has(id)) {
      return;
    }
    seen.add(id);
    next.push(id);
  });
  return next;
}

function withIntent(entry, watchedEpisodeIds) {
  return {
    ...entry,
    intent: entry.intent === 'plan' ? 'watching' : entry.intent,
    watchedEpisodeIds,
  };
}

export function markNextReleased(show, entry, today) {
  if (!entry) {
    return { entry, marked: null, added: [], previousIntent: null };
  }
  const next = getNextEpisode(show, entry, today);
  const watched = new Set(entry.watchedEpisodeIds || []);
  if (!next || watched.has(next.id)) {
    return { entry, marked: null, added: [], previousIntent: entry.intent };
  }
  return {
    previousIntent: entry.intent,
    marked: next,
    added: [next.id],
    entry: withIntent(entry, uniqueIds([...(entry.watchedEpisodeIds || []), next.id])),
  };
}

export function toggleReleasedEpisode(show, entry, episodeId, today) {
  const base = entry || { intent: 'watching', watchedEpisodeIds: [], rating: null };
  const episode = listEpisodes(show).find((item) => item.id === episodeId);
  if (!episode || !isReleased(episode, today)) {
    return { entry: base, marked: null, added: [], removed: [] };
  }
  const currentIds = uniqueIds(base.watchedEpisodeIds);
  const watched = new Set(currentIds);
  if (episode.season === 0) {
    if (watched.has(episode.id)) {
      return {
        entry: { ...base, watchedEpisodeIds: currentIds.filter((id) => id !== episode.id) },
        marked: null,
        added: [],
        removed: [episode.id],
      };
    }
    return {
      entry: withIntent(base, uniqueIds([...currentIds, episode.id])),
      marked: episode,
      added: [episode.id],
      removed: [],
    };
  }
  const released = releasedEpisodes(show, today);
  const index = released.findIndex((item) => item.id === episode.id);
  if (index < 0) {
    return { entry: base, marked: null, added: [], removed: [] };
  }
  if (watched.has(episode.id)) {
    const remove = new Set(released.slice(index).map((item) => item.id));
    return {
      entry: { ...base, watchedEpisodeIds: currentIds.filter((id) => !remove.has(id)) },
      marked: null,
      added: [],
      removed: [...remove],
    };
  }
  const added = released.slice(0, index + 1).map((item) => item.id).filter((id) => !watched.has(id));
  return {
    entry: withIntent(base, uniqueIds([...currentIds, ...added])),
    marked: episode,
    added,
    removed: [],
  };
}

export function undoAddedEpisodes(entry, added, previousIntent) {
  return undoEpisodeChanges(entry, { added, previousIntent });
}

export function undoEpisodeChanges(entry, { added = [], removed = [], previousIntent } = {}) {
  if (!entry) {
    return entry;
  }
  const drop = new Set(added || []);
  const ids = uniqueIds(entry.watchedEpisodeIds).filter((id) => !drop.has(id));
  (removed || []).forEach((id) => {
    if (typeof id === 'string' && id) {
      ids.push(id);
    }
  });
  return {
    ...entry,
    intent: previousIntent || entry.intent,
    watchedEpisodeIds: uniqueIds(ids),
  };
}

export function markSeasonWatched(show, entry, seasonNumber, today) {
  const base = entry || { intent: 'watching', watchedEpisodeIds: [], rating: null };
  const released = seasonReleasedEpisodes(show, seasonNumber, today);
  const watched = new Set(base.watchedEpisodeIds || []);
  const added = released.map((episode) => episode.id).filter((id) => !watched.has(id));
  if (!added.length) {
    return { entry: base, added: [], removed: [], previousIntent: base.intent, created: !entry };
  }
  return {
    previousIntent: base.intent,
    created: !entry,
    added,
    removed: [],
    entry: withIntent(base, uniqueIds([...(base.watchedEpisodeIds || []), ...added])),
  };
}

export function markSeasonUnwatched(show, entry, seasonNumber, today) {
  if (!entry) {
    return { entry, added: [], removed: [], previousIntent: null, created: false };
  }
  const released = new Set(seasonReleasedEpisodes(show, seasonNumber, today).map((episode) => episode.id));
  const removed = uniqueIds(entry.watchedEpisodeIds).filter((id) => released.has(id));
  if (!removed.length) {
    return { entry, added: [], removed: [], previousIntent: entry.intent, created: false };
  }
  return {
    previousIntent: entry.intent,
    created: false,
    added: [],
    removed,
    entry: {
      ...entry,
      watchedEpisodeIds: uniqueIds(entry.watchedEpisodeIds).filter((id) => !released.has(id)),
    },
  };
}
