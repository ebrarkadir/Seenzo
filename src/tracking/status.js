export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function listEpisodes(show) {
  return (show?.seasons || [])
    .flatMap((season) => season.episodes || [])
    .slice()
    .sort((a, b) => a.season - b.season || a.number - b.number);
}

export function isReleased(episode, today = dateKey()) {
  return Boolean(episode?.airDate) && episode.airDate <= today;
}

export function releasedEpisodes(show, today = dateKey()) {
  return listEpisodes(show).filter((episode) => episode.season !== 0 && isReleased(episode, today));
}

export function deriveShowStatus(show, entry, today = dateKey()) {
  if (!entry) {
    return null;
  }
  if (entry.intent === 'plan') {
    return 'plan';
  }
  if (entry.intent === 'dropped') {
    return 'dropped';
  }

  const watched = new Set(entry.watchedEpisodeIds || []);
  const hasUnwatched = releasedEpisodes(show, today).some((episode) => !watched.has(episode.id));
  if (hasUnwatched) {
    return 'watching';
  }
  if (show.releaseStatus === 'ended') {
    return 'completed';
  }
  return 'caughtUp';
}

export function getNextEpisode(show, entry, today = dateKey()) {
  const watched = new Set(entry?.watchedEpisodeIds || []);
  return releasedEpisodes(show, today).find((episode) => !watched.has(episode.id)) || null;
}

export function getProgress(show, entry, today = dateKey()) {
  const released = releasedEpisodes(show, today);
  const watched = new Set(entry?.watchedEpisodeIds || []);
  const watchedCount = released.filter((episode) => watched.has(episode.id)).length;
  return { watched: watchedCount, total: released.length };
}

export function watchedThroughIds(show, episodeId, today = dateKey()) {
  const released = releasedEpisodes(show, today);
  const index = released.findIndex((episode) => episode.id === episodeId);
  if (index < 0) {
    return [];
  }
  return released.slice(0, index + 1).map((episode) => episode.id);
}

export function lastWatchedEpisode(show, entry) {
  const watched = new Set(entry?.watchedEpisodeIds || []);
  const episodes = listEpisodes(show).filter((episode) => watched.has(episode.id));
  return episodes.length ? episodes[episodes.length - 1] : null;
}

export function upcomingForShows(pairs, today = dateKey()) {
  const items = [];
  pairs.forEach(({ show }) => {
    listEpisodes(show).forEach((episode) => {
      if (episode.airDate && episode.airDate <= today) {
        return;
      }
      const seasonBlock = show.seasons.find((season) => season.season === episode.season);
      const seasonStarted = (seasonBlock?.episodes || []).some((item) => item.airDate && item.airDate <= today);
      items.push({
        id: episode.id,
        show,
        episode,
        kind: !seasonStarted && episode.number === 1 ? 'season' : 'episode',
        airDate: episode.airDate || null,
      });
    });
  });
  items.sort((a, b) => {
    if (!a.airDate && !b.airDate) {
      return a.id.localeCompare(b.id);
    }
    if (!a.airDate) {
      return 1;
    }
    if (!b.airDate) {
      return -1;
    }
    return a.airDate.localeCompare(b.airDate) || a.episode.number - b.episode.number;
  });
  return items;
}

export function episodeCode(episode) {
  const season = String(episode.season).padStart(2, '0');
  const number = String(episode.number).padStart(2, '0');
  return { season, episode: number };
}
