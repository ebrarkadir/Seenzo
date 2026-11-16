import { isEpisodeWatched } from './watchlist';

export const PERSONAL_RATING_FILTERS = ['all', 'movie', 'show', 'episode'];
export const PERSONAL_RATING_SORTS = ['highest', 'lowest', 'title'];

export function countPersonalRatings({ movies, shows, showRatings, episodeRatings }) {
  const movieRatings = Object.values(movies || {}).filter((entry) => entry?.rating != null).length;
  const showRatingIds = new Set([
    ...Object.keys(showRatings || {}).filter((id) => showRatings[id] != null),
    ...Object.entries(shows || {})
      .filter(([, entry]) => entry?.rating != null)
      .map(([id]) => id),
  ]);
  const episodeRatingCount = Object.values(episodeRatings || {}).filter((value) => value != null).length;
  return movieRatings + showRatingIds.size + episodeRatingCount;
}

export function countPersonalRatingsByKind(items) {
  const counts = { all: 0, movie: 0, show: 0, episode: 0 };
  (items || []).forEach((item) => {
    if (!item || item.rating == null) {
      return;
    }
    counts.all += 1;
    if (counts[item.kind] != null) {
      counts[item.kind] += 1;
    }
  });
  return counts;
}

export function collectPersonalRatings(state) {
  const movies = state?.movies || {};
  const shows = state?.shows || {};
  const showRatings = state?.showRatings || {};
  const episodeRatings = state?.episodeRatings || {};
  const episodeMeta = state?.episodeMeta || {};
  const keptEpisodes = state?.keptEpisodes || {};
  const items = [];

  Object.entries(movies).forEach(([id, entry]) => {
    if (entry?.rating == null) {
      return;
    }
    items.push({
      key: `movie:${id}`,
      kind: 'movie',
      id,
      rating: entry.rating,
      editable: Boolean(entry.watched),
      showId: null,
      season: null,
      number: null,
    });
  });

  const showIds = new Set([
    ...Object.keys(showRatings).filter((id) => showRatings[id] != null),
    ...Object.entries(shows)
      .filter(([, entry]) => entry?.rating != null)
      .map(([id]) => id),
  ]);
  showIds.forEach((id) => {
    const rating = shows[id]?.rating ?? showRatings[id] ?? null;
    if (rating == null) {
      return;
    }
    items.push({
      key: `show:${id}`,
      kind: 'show',
      id,
      rating,
      editable: true,
      showId: id,
      season: null,
      number: null,
    });
  });

  Object.entries(episodeRatings).forEach(([id, rating]) => {
    if (rating == null) {
      return;
    }
    const meta = episodeMeta[id] || keptEpisodes[id] || null;
    items.push({
      key: `episode:${id}`,
      kind: 'episode',
      id,
      rating,
      editable: isEpisodeWatched(state, id),
      showId: meta?.showId || null,
      season: Number.isInteger(meta?.season) ? meta.season : null,
      number: Number.isInteger(meta?.number) ? meta.number : null,
    });
  });

  return items;
}

export function filterPersonalRatings(items, filter = 'all') {
  if (!filter || filter === 'all') {
    return items || [];
  }
  return (items || []).filter((item) => item.kind === filter);
}

export function searchPersonalRatings(items, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return items || [];
  }
  return (items || []).filter((item) => {
    const haystack = [
      item.title,
      item.showTitle,
      item.searchText,
      item.id,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function sortPersonalRatings(items, sort = 'highest') {
  const list = [...(items || [])];
  const byTitle = (left, right) => {
    const titleCmp = String(left.title || left.id || '').localeCompare(
      String(right.title || right.id || ''),
      undefined,
      { sensitivity: 'base' }
    );
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return String(left.key).localeCompare(String(right.key));
  };

  if (sort === 'lowest') {
    list.sort((left, right) => {
      const ratingCmp = (left.rating || 0) - (right.rating || 0);
      return ratingCmp !== 0 ? ratingCmp : byTitle(left, right);
    });
    return list;
  }

  if (sort === 'title') {
    list.sort(byTitle);
    return list;
  }

  // Default / highest — deterministic fallback (no reliable ratedAt exists).
  list.sort((left, right) => {
    const ratingCmp = (right.rating || 0) - (left.rating || 0);
    return ratingCmp !== 0 ? ratingCmp : byTitle(left, right);
  });
  return list;
}

function padEpisodePart(value) {
  return String(value).padStart(2, '0');
}

export function enrichPersonalRatingItem(item, {
  resolveMovie,
  resolveShow,
  listEpisodes,
} = {}) {
  if (!item) {
    return null;
  }
  if (item.kind === 'movie') {
    const movie = typeof resolveMovie === 'function' ? resolveMovie(item.id) : null;
    const title = movie?.title || item.id;
    return {
      ...item,
      title,
      showTitle: null,
      year: movie?.year || null,
      posterPath: movie?.posterPath || null,
      searchText: title,
    };
  }
  if (item.kind === 'show') {
    const show = typeof resolveShow === 'function' ? resolveShow(item.id) : null;
    const title = show?.title || item.id;
    return {
      ...item,
      title,
      showTitle: null,
      year: show?.year || null,
      posterPath: show?.posterPath || null,
      searchText: title,
    };
  }

  const show = item.showId && typeof resolveShow === 'function' ? resolveShow(item.showId) : null;
  const episodes = show && typeof listEpisodes === 'function' ? listEpisodes(show) : [];
  const episode = episodes.find((entry) => entry.id === item.id) || null;
  const season = item.season ?? episode?.season ?? null;
  const number = item.number ?? episode?.number ?? null;
  const episodeTitle = episode?.title || null;
  const showTitle = show?.title || item.showId || null;
  const code = season != null && number != null
    ? `S${padEpisodePart(season)}E${padEpisodePart(number)}`
    : null;
  const title = episodeTitle || code || item.id;
  return {
    ...item,
    season,
    number,
    title,
    showTitle,
    year: null,
    posterPath: episode?.posterPath || show?.posterPath || null,
    episodeCode: code,
    searchText: [episodeTitle, showTitle, code].filter(Boolean).join(' '),
  };
}

export function enrichPersonalRatingItems(items, helpers) {
  return (items || []).map((item) => enrichPersonalRatingItem(item, helpers)).filter(Boolean);
}

export function buildPersonalRatingsView(state, {
  filter = 'all',
  query = '',
  sort = 'highest',
  resolveMovie,
  resolveShow,
  listEpisodes,
} = {}) {
  const collected = enrichPersonalRatingItems(collectPersonalRatings(state), {
    resolveMovie,
    resolveShow,
    listEpisodes,
  });
  const filtered = filterPersonalRatings(collected, filter);
  const searched = searchPersonalRatings(filtered, query);
  return sortPersonalRatings(searched, sort);
}
