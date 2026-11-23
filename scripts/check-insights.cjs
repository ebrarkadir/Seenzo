const fs = require('fs');
const path = require('path');

function loadModules(relativePaths, returned) {
  const code = relativePaths.map((relativePath) => {
    const file = path.join(__dirname, '..', relativePath);
    return fs.readFileSync(file, 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]+\};?\s*$/gm, '')
      .replace(/^export /gm, '');
  }).join('\n');
  return new Function(`${code}\nreturn { ${returned} };`)();
}

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const api = loadModules(
  [
    'src/tracking/watchlist.js',
    'src/tracking/status.js',
    'src/tracking/personalRatings.js',
    'src/tracking/activityEvents.js',
    'src/insights/calculateActivity.js',
    'src/insights/calculateInsights.js',
  ],
  [
    'formatWatchDuration',
    'calculateMoviesWatched',
    'calculateEpisodesWatched',
    'calculateAveragePersonalRating',
    'calculateRatingDistribution',
    'calculateWatchTime',
    'calculateGenreCounts',
    'calculateMostWatchedShows',
    'buildInsightsDashboard',
    'listWatchedEpisodeRefs',
  ].join(', ')
);

const empty = {
  movies: {},
  shows: {},
  showRatings: {},
  episodeRatings: {},
  episodeMeta: {},
  keptEpisodes: {},
};

expect('empty average is null', api.calculateAveragePersonalRating(empty), { average: null, count: 0 });
expect('empty movies watched', api.calculateMoviesWatched(empty.movies), 0);
expect('empty episodes watched', api.calculateEpisodesWatched(empty), 0);
expect('format 125 minutes', api.formatWatchDuration(125), { hours: 2, minutes: 5, totalMinutes: 125 });

const moviesOnly = {
  ...empty,
  movies: {
    'trakt-movie-1': { saved: true, watched: true, rating: 8 },
    'trakt-movie-2': { saved: true, watched: false, rating: 9 },
    'trakt-movie-3': { saved: true, watched: true, rating: null },
  },
};
expect('movies watched ignores watchlist-only', api.calculateMoviesWatched(moviesOnly.movies), 2);

const catalog = {
  resolveMovie: (id) => {
    if (id === 'trakt-movie-1') return { id, runtime: 120, genres: ['action', 'thriller'] };
    if (id === 'trakt-movie-3') return { id, runtime: null, genres: [] };
    return null;
  },
  resolveShow: (id) => {
    if (id === 'trakt-show-1') {
      return {
        id,
        title: 'Show One',
        genres: ['drama', 'thriller'],
        runtime: 50,
        posterPath: '/a.jpg',
        seasons: [{
          season: 1,
          episodes: [
            { id: 'trakt-episode-1', season: 1, number: 1, runtime: 48 },
            { id: 'trakt-episode-2', season: 1, number: 2, runtime: null },
            { id: 'trakt-episode-3', season: 1, number: 3, runtime: 52 },
          ],
        }],
      };
    }
    if (id === 'trakt-show-2') {
      return {
        id,
        title: 'Show Two',
        genres: ['comedy'],
        runtime: null,
        posterPath: '/b.jpg',
        seasons: [{
          season: 1,
          episodes: [
            { id: 'trakt-episode-10', season: 1, number: 1, runtime: 30 },
            { id: 'trakt-episode-11', season: 1, number: 2, runtime: 30 },
          ],
        }],
      };
    }
    return null;
  },
};

const mixed = {
  movies: {
    'trakt-movie-1': { saved: true, watched: true, rating: 8 },
    'trakt-movie-3': { saved: true, watched: true, rating: 6 },
  },
  shows: {
    'trakt-show-1': {
      intent: 'watching',
      watchedEpisodeIds: ['trakt-episode-1', 'trakt-episode-2', 'trakt-episode-1'],
      rating: 9,
    },
    'trakt-show-2': {
      intent: 'watching',
      watchedEpisodeIds: ['trakt-episode-10', 'trakt-episode-11'],
      rating: null,
    },
  },
  showRatings: {},
  episodeRatings: {
    'trakt-episode-1': 7,
    'trakt-episode-10': 10,
  },
  episodeMeta: {
    'trakt-episode-1': { showId: 'trakt-show-1', season: 1, number: 1 },
    'trakt-episode-2': { showId: 'trakt-show-1', season: 1, number: 2 },
    'trakt-episode-10': { showId: 'trakt-show-2', season: 1, number: 1 },
    'trakt-episode-11': { showId: 'trakt-show-2', season: 1, number: 2 },
  },
  keptEpisodes: {},
};

expect('unique episode count after duplicates', api.calculateEpisodesWatched(mixed), 4);
expect('rating average excludes unrated', api.calculateAveragePersonalRating(mixed), {
  average: 8,
  count: 5,
});

const distribution = api.calculateRatingDistribution(mixed, 'all');
expect('distribution length 10', distribution.length, 10);
expect('distribution score 8 count', distribution.find((item) => item.score === 8).count, 1);
expect('movie filter distribution', api.calculateRatingDistribution(mixed, 'movie').reduce((sum, item) => sum + item.count, 0), 2);
expect('episode filter distribution', api.calculateRatingDistribution(mixed, 'episode').reduce((sum, item) => sum + item.count, 0), 2);

const watchTime = api.calculateWatchTime(mixed, catalog);
// movie1 120 + ep1 48 + ep2 estimated show 50 + ep10 30 + ep11 30 = 278; movie3 missing
expect('watch time uses real and show fallback runtimes', watchTime.totalMinutes, 278);
expect('watch time marks estimated when fallback/missing', watchTime.estimated, true);
expect('missing movie runtime tracked', watchTime.coverage.moviesMissingRuntime, 1);
expect('episode estimated from show runtime', watchTime.coverage.episodesEstimatedFromShow, 1);

const genres = api.calculateGenreCounts(mixed, { ...catalog, limit: 5 });
expect('genres rank thriller highest', genres.items[0].genre, 'thriller');
expect('show counted once for genres', genres.items.find((item) => item.genre === 'drama').count, 1);
expect('missing genre media counted', genres.mediaMissingGenres >= 1, true);

const topShows = api.calculateMostWatchedShows(mixed, { resolveShow: catalog.resolveShow, limit: 5 });
expect('most watched ranked by watched episodes', topShows.map((item) => item.showId), ['trakt-show-1', 'trakt-show-2']);
expect('most watched uses actual watched count', topShows[0].watchedCount, 2);
expect('most watched total excludes missing air-date safely', topShows[0].totalEpisodes, 3);

const breakingBadLike = {
  ...empty,
  shows: {
    'trakt-show-bb': {
      intent: 'watching',
      watchedEpisodeIds: [
        'trakt-episode-101',
        'trakt-episode-102',
        'trakt-episode-s01',
        'trakt-episode-s02',
        'trakt-episode-s03',
        'trakt-episode-s04',
        'trakt-episode-s05',
        'trakt-episode-s06',
        'trakt-episode-s07',
        'trakt-episode-s08',
      ],
      rating: null,
    },
  },
};
const bbCatalog = {
  resolveShow: (id) => {
    if (id !== 'trakt-show-bb') return null;
    return {
      id,
      title: 'Breaking Bad',
      seasons: [
        {
          season: 0,
          episodes: [
            { id: 'trakt-episode-s01', season: 0, number: 1, airDate: '2009-01-01' },
            { id: 'trakt-episode-s02', season: 0, number: 2, airDate: '2009-01-02' },
            { id: 'trakt-episode-s03', season: 0, number: 3, airDate: '2009-01-03' },
            { id: 'trakt-episode-s04', season: 0, number: 4, airDate: '2009-01-04' },
            { id: 'trakt-episode-s05', season: 0, number: 5, airDate: '2009-01-05' },
            { id: 'trakt-episode-s06', season: 0, number: 6, airDate: '2009-01-06' },
            { id: 'trakt-episode-s07', season: 0, number: 7, airDate: '2009-01-07' },
            { id: 'trakt-episode-s08', season: 0, number: 8, airDate: '2009-01-08' },
          ],
        },
        {
          season: 1,
          episodes: [
            { id: 'trakt-episode-101', season: 1, number: 1, airDate: '2008-01-20' },
            { id: 'trakt-episode-102', season: 1, number: 2, airDate: '2008-01-27' },
          ],
        },
      ],
    };
  },
};
const bbTop = api.calculateMostWatchedShows(breakingBadLike, { ...bbCatalog, limit: 5, today: '2026-11-16' });
expect('specials do not inflate watched numerator', bbTop[0].watchedCount, 2);
expect('specials do not shrink comparable total', bbTop[0].totalEpisodes, 2);
expect('watched never exceeds total', bbTop[0].watchedCount <= bbTop[0].totalEpisodes, true);

const dashboard = api.buildInsightsDashboard(mixed, { ...catalog, ratingFilter: 'all' });
expect('viewing activity present', Boolean(dashboard.viewingActivity), true);
expect('no fabricated historical activity from watched state', dashboard.viewingActivity.hasLoggingEvents, false);
expect('dashboard overview movies', dashboard.overview.moviesWatched, 2);

const hidden = api.buildInsightsDashboard(mixed, { ...catalog, hideDemo: true });
expect('demo hide clears dashboard activity', hidden.overview.moviesWatched, 0);

const noDefaultRuntime = api.calculateWatchTime({
  ...empty,
  shows: {
    'trakt-show-x': { intent: 'watching', watchedEpisodeIds: ['trakt-episode-x'], rating: null },
  },
  episodeMeta: { 'trakt-episode-x': { showId: 'trakt-show-x', season: 1, number: 1 } },
}, {
  resolveShow: () => ({
    id: 'trakt-show-x',
    genres: [],
    runtime: null,
    seasons: [{ season: 1, episodes: [{ id: 'trakt-episode-x', season: 1, number: 1, runtime: null }] }],
  }),
});
expect('never invents 45 minute default', noDefaultRuntime.totalMinutes, 0);
expect('missing episode runtime covered honestly', noDefaultRuntime.coverage.episodesMissingRuntime, 1);

const profile = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/profile.js'), 'utf8');
const activity = fs.readFileSync(path.join(__dirname, '..', 'src/components/profile/ProfileActivitySection.js'), 'utf8');
const layout = fs.readFileSync(path.join(__dirname, '..', 'src/app/_layout.js'), 'utf8');
const screen = fs.readFileSync(path.join(__dirname, '..', 'src/app/insights.js'), 'utf8');
expect('profile links to insights', profile.includes("router.push('/insights')"));
expect('activity heading has see insights action', activity.includes('insights.seeInsights') && activity.includes('onPressInsights'));
expect('insights route registered', layout.includes('insights'));
expect('insights uses buildInsightsDashboard', screen.includes('buildInsightsDashboard'));
expect('insights renders viewing activity section', screen.includes('ViewingActivitySection'));
const activityUi = fs.readFileSync(path.join(__dirname, '..', 'src/components/insights/ViewingActivitySection.js'), 'utf8');
const en = fs.readFileSync(path.join(__dirname, '..', 'src/i18n/locales/en.json'), 'utf8');
expect('compact empty copy', en.includes('"activityEmptyTitle": "No activity recorded yet"'));
expect('compact empty body', en.includes('"activityEmptyBody": "Your new watch activity will appear here."'));
expect('empty UI branches on hasEvents', activityUi.includes('!hasEvents'));
expect('chart rendered only in events branch', activityUi.indexOf('styles.chart') > activityUi.indexOf('{hasEvents ?') || activityUi.includes('hasEvents ? ('));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Insights checks passed (${checks.length})`);
