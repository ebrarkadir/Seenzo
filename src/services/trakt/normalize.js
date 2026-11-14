export function traktShowKey(traktId) {
  return `trakt-show-${traktId}`;
}

export function traktMovieKey(traktId) {
  return `trakt-movie-${traktId}`;
}

export function traktEpisodeKey(traktId) {
  return `trakt-episode-${traktId}`;
}

export function parseTraktShowKey(id) {
  const match = /^trakt-show-(\d+)$/.exec(String(id || ''));
  return match ? match[1] : null;
}

export function parseTraktMovieKey(id) {
  const match = /^trakt-movie-(\d+)$/.exec(String(id || ''));
  return match ? match[1] : null;
}

export function pickPosterPath(images) {
  const posters = images?.poster;
  if (!Array.isArray(posters) || posters.length === 0) {
    return null;
  }
  const thumb = posters.find((item) => typeof item === 'string' && item.includes('/thumb/'));
  const path = thumb || posters.find((item) => typeof item === 'string');
  return path || null;
}

export function pickHeadshotPath(images) {
  const shots = images?.headshot;
  if (!Array.isArray(shots) || shots.length === 0) {
    return null;
  }
  const thumb = shots.find((item) => typeof item === 'string' && item.includes('/thumb/'));
  const medium = shots.find((item) => typeof item === 'string' && item.includes('/medium/'));
  const path = thumb || medium || shots.find((item) => typeof item === 'string');
  return path || null;
}

export function airDateFromTrakt(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    return null;
  }
  const [year, month, day] = match[1].split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return match[1];
}

export function seasonNeedsEpisodeFetch(season) {
  return typeof season?.number === 'number' && (!Array.isArray(season.episodes) || season.episodes.length === 0);
}

export function mergeCatalogPage(current, incoming) {
  const seen = new Set((current || []).map((item) => item?.id).filter(Boolean));
  const next = [];
  (incoming || []).forEach((item) => {
    if (!item?.id || seen.has(item.id)) {
      return;
    }
    seen.add(item.id);
    next.push(item);
  });
  return [...(current || []), ...next];
}

export function mapReleaseStatus(status) {
  if (status === 'ended' || status === 'canceled') {
    return 'ended';
  }
  if (status === 'returning series' || status === 'continuing') {
    return 'returning';
  }
  if (!status) {
    return null;
  }
  return 'ongoing';
}

function toEpisode(episode, seasonNumber) {
  const traktId = episode?.ids?.trakt;
  const season = typeof episode?.season === 'number' ? episode.season : seasonNumber;
  if (!traktId || typeof episode?.number !== 'number' || typeof season !== 'number') {
    return null;
  }
  return {
    id: traktEpisodeKey(traktId),
    traktId,
    season,
    number: episode.number,
    title: episode.title || '',
    overview: typeof episode.overview === 'string' ? episode.overview : '',
    runtime: typeof episode.runtime === 'number' ? episode.runtime : null,
    airDate: airDateFromTrakt(episode.first_aired),
    communityRating: typeof episode.rating === 'number' ? episode.rating : null,
    posterPath: pickPosterPath(episode.images),
  };
}

function toSeason(season) {
  if (typeof season?.number !== 'number') {
    return null;
  }
  return {
    season: season.number,
    title: season.title || '',
    episodeCount: typeof season.episode_count === 'number' ? season.episode_count : null,
    episodes: Array.isArray(season.episodes)
      ? season.episodes.map((episode) => toEpisode(episode, season.number)).filter(Boolean)
      : [],
  };
}

export function toAppShow(payload, seasons, hydrated) {
  const traktId = payload?.ids?.trakt;
  if (!traktId || !payload.title) {
    return null;
  }
  return {
    id: traktShowKey(traktId),
    traktId,
    title: payload.title,
    year: payload.year ?? null,
    overview: payload.overview || '',
    genres: Array.isArray(payload.genres) ? payload.genres : [],
    releaseStatus: mapReleaseStatus(payload.status),
    communityRating: typeof payload.rating === 'number' ? payload.rating : null,
    posterPath: pickPosterPath(payload.images),
    hydrated: Boolean(hydrated),
    seasons: Array.isArray(seasons) ? seasons.map(toSeason).filter(Boolean) : [],
  };
}

export function toAppMovie(payload) {
  const traktId = payload?.ids?.trakt;
  if (!traktId || !payload.title) {
    return null;
  }
  return {
    id: traktMovieKey(traktId),
    traktId,
    title: payload.title,
    year: payload.year ?? null,
    overview: payload.overview || '',
    genres: Array.isArray(payload.genres) ? payload.genres : [],
    runtime: typeof payload.runtime === 'number' ? payload.runtime : null,
    released: airDateFromTrakt(payload.released),
    communityRating: typeof payload.rating === 'number' ? payload.rating : null,
    posterPath: pickPosterPath(payload.images),
  };
}

export function showFromSearch(entry) {
  return toAppShow(entry?.show, [], false);
}

export function movieFromSearch(entry) {
  return toAppMovie(entry?.movie);
}
