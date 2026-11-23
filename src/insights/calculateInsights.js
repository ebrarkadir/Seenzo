import { collectPersonalRatings } from '../tracking/personalRatings';
import { getProgress, listEpisodes } from '../tracking/status';
import { buildViewingActivity } from './calculateActivity';

function uniqueIds(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

function isPositiveRuntime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function formatWatchDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return { hours, minutes: rem, totalMinutes: minutes };
}

export function calculateMoviesWatched(movies) {
  return Object.values(movies || {}).filter((entry) => entry?.watched).length;
}

export function calculateEpisodesWatched(state) {
  const shows = state?.shows || {};
  const kept = state?.keptEpisodes || {};
  const ids = new Set();
  Object.values(shows).forEach((entry) => {
    (entry?.watchedEpisodeIds || []).forEach((id) => {
      if (id) ids.add(id);
    });
  });
  Object.entries(kept).forEach(([id, entry]) => {
    if (entry?.watched && id) {
      ids.add(id);
    }
  });
  return ids.size;
}

export function calculateAveragePersonalRating(state) {
  const items = collectPersonalRatings(state);
  if (!items.length) {
    return { average: null, count: 0 };
  }
  const sum = items.reduce((total, item) => total + item.rating, 0);
  const average = Math.round((sum / items.length) * 10) / 10;
  return { average, count: items.length };
}

export function calculateRatingDistribution(state, filter = 'all') {
  const buckets = {};
  for (let score = 1; score <= 10; score += 1) {
    buckets[score] = 0;
  }
  collectPersonalRatings(state).forEach((item) => {
    if (filter !== 'all' && item.kind !== filter) {
      return;
    }
    if (buckets[item.rating] == null) {
      return;
    }
    buckets[item.rating] += 1;
  });
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => ({
    score,
    count: buckets[score],
  }));
}

/**
 * Resolve watched episode ids with show ownership for runtime/genre work.
 */
export function listWatchedEpisodeRefs(state) {
  const shows = state?.shows || {};
  const episodeMeta = state?.episodeMeta || {};
  const keptEpisodes = state?.keptEpisodes || {};
  const byId = new Map();

  Object.entries(shows).forEach(([showId, entry]) => {
    (entry?.watchedEpisodeIds || []).forEach((episodeId) => {
      if (!episodeId || byId.has(episodeId)) {
        return;
      }
      const meta = episodeMeta[episodeId] || keptEpisodes[episodeId] || null;
      byId.set(episodeId, {
        episodeId,
        showId: meta?.showId || showId,
        season: Number.isInteger(meta?.season) ? meta.season : null,
        number: Number.isInteger(meta?.number) ? meta.number : null,
      });
    });
  });

  Object.entries(keptEpisodes).forEach(([episodeId, entry]) => {
    if (!entry?.watched || !episodeId || byId.has(episodeId)) {
      return;
    }
    byId.set(episodeId, {
      episodeId,
      showId: entry.showId || null,
      season: Number.isInteger(entry.season) ? entry.season : null,
      number: Number.isInteger(entry.number) ? entry.number : null,
    });
  });

  return [...byId.values()];
}

export function calculateWatchTime(state, {
  resolveMovie,
  resolveShow,
} = {}) {
  const movies = state?.movies || {};
  let totalMinutes = 0;
  let movieMinutes = 0;
  let episodeMinutes = 0;
  let moviesWithRuntime = 0;
  let moviesMissingRuntime = 0;
  let episodesWithRuntime = 0;
  let episodesEstimatedFromShow = 0;
  let episodesMissingRuntime = 0;

  Object.entries(movies).forEach(([movieId, entry]) => {
    if (!entry?.watched) {
      return;
    }
    const movie = typeof resolveMovie === 'function' ? resolveMovie(movieId) : null;
    if (isPositiveRuntime(movie?.runtime)) {
      movieMinutes += movie.runtime;
      totalMinutes += movie.runtime;
      moviesWithRuntime += 1;
      return;
    }
    moviesMissingRuntime += 1;
  });

  const showCache = new Map();
  const getShow = (showId) => {
    if (!showId || typeof resolveShow !== 'function') {
      return null;
    }
    if (showCache.has(showId)) {
      return showCache.get(showId);
    }
    const show = resolveShow(showId);
    showCache.set(showId, show || null);
    return show || null;
  };

  listWatchedEpisodeRefs(state).forEach((ref) => {
    const show = getShow(ref.showId);
    const episodes = show ? listEpisodes(show) : [];
    const episode = episodes.find((item) => item.id === ref.episodeId)
      || episodes.find((item) => (
        ref.season != null
        && ref.number != null
        && item.season === ref.season
        && item.number === ref.number
      ))
      || null;

    if (isPositiveRuntime(episode?.runtime)) {
      episodeMinutes += episode.runtime;
      totalMinutes += episode.runtime;
      episodesWithRuntime += 1;
      return;
    }
    if (isPositiveRuntime(show?.runtime)) {
      episodeMinutes += show.runtime;
      totalMinutes += show.runtime;
      episodesEstimatedFromShow += 1;
      return;
    }
    episodesMissingRuntime += 1;
  });

  const coveredUnits = moviesWithRuntime + episodesWithRuntime + episodesEstimatedFromShow;
  const missingUnits = moviesMissingRuntime + episodesMissingRuntime;
  const estimated = episodesEstimatedFromShow > 0 || missingUnits > 0;

  return {
    totalMinutes,
    movieMinutes,
    episodeMinutes,
    display: formatWatchDuration(totalMinutes),
    estimated,
    coverage: {
      moviesWithRuntime,
      moviesMissingRuntime,
      episodesWithRuntime,
      episodesEstimatedFromShow,
      episodesMissingRuntime,
      coveredUnits,
      missingUnits,
    },
  };
}

export function calculateGenreCounts(state, {
  resolveMovie,
  resolveShow,
  limit = 5,
} = {}) {
  const counts = new Map();
  let mediaWithGenres = 0;
  let mediaMissingGenres = 0;

  const addGenres = (genres) => {
    const list = Array.isArray(genres)
      ? uniqueIds(genres.map((genre) => String(genre || '').trim()).filter(Boolean))
      : [];
    if (!list.length) {
      mediaMissingGenres += 1;
      return;
    }
    mediaWithGenres += 1;
    list.forEach((genre) => {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    });
  };

  Object.entries(state?.movies || {}).forEach(([movieId, entry]) => {
    if (!entry?.watched) {
      return;
    }
    const movie = typeof resolveMovie === 'function' ? resolveMovie(movieId) : null;
    addGenres(movie?.genres);
  });

  Object.entries(state?.shows || {}).forEach(([showId, entry]) => {
    const watchedCount = (entry?.watchedEpisodeIds || []).length;
    if (watchedCount < 1) {
      return;
    }
    const show = typeof resolveShow === 'function' ? resolveShow(showId) : null;
    addGenres(show?.genres);
  });

  const ranked = [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((left, right) => right.count - left.count || left.genre.localeCompare(right.genre))
    .slice(0, Math.max(0, limit));

  const maxCount = ranked.reduce((max, item) => Math.max(max, item.count), 0);

  return {
    items: ranked.map((item) => ({
      ...item,
      ratio: maxCount > 0 ? item.count / maxCount : 0,
    })),
    mediaWithGenres,
    mediaMissingGenres,
  };
}

function mostWatchedProgress(show, entry, today) {
  // Prefer the same released-regular rules as show detail progress.
  const progress = getProgress(show, entry, today);
  if (progress.total > 0 || progress.watched > 0) {
    return progress;
  }
  // Catalog without air dates: still exclude season 0 specials from both sides.
  const regular = listEpisodes(show).filter((episode) => episode.season !== 0);
  if (!regular.length) {
    return { watched: 0, total: 0 };
  }
  const watched = new Set(uniqueIds(entry?.watchedEpisodeIds || []));
  return {
    watched: regular.filter((episode) => watched.has(episode.id)).length,
    total: regular.length,
  };
}

export function calculateMostWatchedShows(state, {
  resolveShow,
  limit = 5,
  today,
} = {}) {
  const rows = Object.entries(state?.shows || {}).map(([showId, entry]) => {
    const show = typeof resolveShow === 'function' ? resolveShow(showId) : null;
    if (show) {
      const progress = mostWatchedProgress(show, entry, today);
      return {
        showId,
        title: show.title || showId,
        posterPath: show.posterPath || null,
        watchedCount: progress.watched,
        totalEpisodes: progress.total,
      };
    }
    return {
      showId,
      title: showId,
      posterPath: null,
      watchedCount: uniqueIds(entry?.watchedEpisodeIds || []).length,
      totalEpisodes: null,
    };
  }).filter((row) => row.watchedCount > 0);

  rows.sort((left, right) => (
    right.watchedCount - left.watchedCount
    || left.title.localeCompare(right.title)
    || left.showId.localeCompare(right.showId)
  ));

  return rows.slice(0, Math.max(0, limit));
}

export function calculateOverviewStats(state, helpers = {}) {
  const watchTime = calculateWatchTime(state, helpers);
  const averageRating = calculateAveragePersonalRating(state);
  return {
    watchTime,
    averageRating,
    moviesWatched: calculateMoviesWatched(state?.movies),
    episodesWatched: calculateEpisodesWatched(state),
  };
}

export function buildInsightsDashboard(state, {
  resolveMovie,
  resolveShow,
  ratingFilter = 'all',
  genreLimit = 5,
  showLimit = 5,
  hideDemo = false,
  activityFilter = 'all',
  activityYear = null,
  activityTimeZone,
} = {}) {
  if (hideDemo || !state) {
    return {
      empty: true,
      overview: {
        watchTime: {
          totalMinutes: 0,
          display: formatWatchDuration(0),
          estimated: false,
          coverage: {
            moviesWithRuntime: 0,
            moviesMissingRuntime: 0,
            episodesWithRuntime: 0,
            episodesEstimatedFromShow: 0,
            episodesMissingRuntime: 0,
            coveredUnits: 0,
            missingUnits: 0,
          },
        },
        averageRating: { average: null, count: 0 },
        moviesWatched: 0,
        episodesWatched: 0,
      },
      ratingDistribution: calculateRatingDistribution({}, ratingFilter),
      genres: { items: [], mediaWithGenres: 0, mediaMissingGenres: 0 },
      mostWatchedShows: [],
      viewingActivity: buildViewingActivity([], {
        year: activityYear,
        filter: activityFilter,
        timeZone: activityTimeZone,
      }),
    };
  }

  const helpers = { resolveMovie, resolveShow };
  return {
    empty: false,
    overview: calculateOverviewStats(state, helpers),
    ratingDistribution: calculateRatingDistribution(state, ratingFilter),
    genres: calculateGenreCounts(state, { ...helpers, limit: genreLimit }),
    mostWatchedShows: calculateMostWatchedShows(state, { resolveShow, limit: showLimit }),
    viewingActivity: buildViewingActivity(state.activityEvents, {
      year: activityYear,
      filter: activityFilter,
      timeZone: activityTimeZone,
    }),
  };
}
