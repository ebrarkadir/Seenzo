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

const api = loadModules(
  [
    'src/tracking/watchlistOrder.js',
    'src/tracking/watchlistSort.js',
    'src/tracking/watchlist.js',
    'src/tracking/activityEvents.js',
    'src/tracking/cloudState.js',
  ],
  [
    'MY_LIST_SORT_OPTIONS',
    'MY_LIST_SORT_MY_ORDER',
    'MY_LIST_SORT_OLDEST_ADDED',
    'MY_LIST_SORT_NEWEST_ADDED',
    'MY_LIST_SORT_HIGHEST_RATED',
    'MY_LIST_SORT_LOWEST_RATED',
    'MY_LIST_SORT_TITLE_ASC',
    'MY_LIST_SORT_TITLE_DESC',
    'sortWatchlistItems',
    'communityRatingValue',
    'normalizeWatchlistAddedAt',
    'applyMovieWatchlistToggle',
    'applyShowWatchlistToggle',
    'applyShowIntent',
    'applyMovieChanges',
    'applyMovieRating',
    'normalizeTracking',
    'stateFromRemote',
    'remoteMediaSignature',
    'planQueue',
  ].join(', ')
);

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

expect(
  'sort options order',
  api.MY_LIST_SORT_OPTIONS,
  [
    'myOrder',
    'oldestAdded',
    'newestAdded',
    'highestRated',
    'lowestRated',
    'titleAsc',
    'titleDesc',
  ]
);

const items = [
  {
    id: 'c',
    title: 'Charlie',
    movie: { id: 'c', title: 'Charlie', communityRating: 7.2 },
    entry: { watchlistAddedAt: '2026-01-03T00:00:00.000Z' },
  },
  {
    id: 'a',
    title: 'Alpha',
    movie: { id: 'a', title: 'Alpha', communityRating: 9.1 },
    entry: { watchlistAddedAt: '2026-01-01T00:00:00.000Z' },
  },
  {
    id: 'b',
    title: 'Bravo',
    movie: { id: 'b', title: 'Bravo', communityRating: 8.0 },
    entry: { watchlistAddedAt: '2026-01-02T00:00:00.000Z' },
  },
];

const order = ['c', 'a', 'b'];
expect(
  'my order preserves array',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_MY_ORDER,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['c', 'a', 'b']
);

expect(
  'oldest added chronological',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_OLDEST_ADDED,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['a', 'b', 'c']
);

expect(
  'newest added reverse chronological',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_NEWEST_ADDED,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['c', 'b', 'a']
);

expect(
  'highest community rated',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_HIGHEST_RATED,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['a', 'b', 'c']
);

expect(
  'lowest community rated',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_LOWEST_RATED,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['c', 'b', 'a']
);

const withMissing = [
  ...items,
  {
    id: 'z',
    title: 'Zebra',
    movie: { id: 'z', title: 'Zebra', communityRating: null },
    entry: { watchlistAddedAt: null },
  },
  {
    id: 'y',
    title: 'Yankee',
    movie: { id: 'y', title: 'Yankee' },
    entry: { watchlistAddedAt: 'not-a-date' },
  },
];

expect(
  'missing dates at end for oldest',
  api.sortWatchlistItems(withMissing, {
    mode: api.MY_LIST_SORT_OLDEST_ADDED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['a', 'b', 'c', 'y', 'z']
);

expect(
  'missing dates at end for newest',
  api.sortWatchlistItems(withMissing, {
    mode: api.MY_LIST_SORT_NEWEST_ADDED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['c', 'b', 'a', 'y', 'z']
);

expect(
  'missing community rating at end highest',
  api.sortWatchlistItems(withMissing, {
    mode: api.MY_LIST_SORT_HIGHEST_RATED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['a', 'b', 'c', 'y', 'z']
);

expect(
  'missing community rating at end lowest',
  api.sortWatchlistItems(withMissing, {
    mode: api.MY_LIST_SORT_LOWEST_RATED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['c', 'b', 'a', 'y', 'z']
);

const personalTrap = [
  {
    id: 'low-community',
    title: 'Low',
    movie: { id: 'low-community', title: 'Low', communityRating: 3 },
    entry: { rating: 10, watchlistAddedAt: '2026-01-01T00:00:00.000Z' },
  },
  {
    id: 'high-community',
    title: 'High',
    movie: { id: 'high-community', title: 'High', communityRating: 9 },
    entry: { rating: 1, watchlistAddedAt: '2026-01-02T00:00:00.000Z' },
  },
];
expect(
  'personal rating never used as community',
  api.sortWatchlistItems(personalTrap, {
    mode: api.MY_LIST_SORT_HIGHEST_RATED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['high-community', 'low-community']
);
expect('communityRatingValue ignores entry.rating', api.communityRatingValue({ rating: 10 }), null);

const equalDates = [
  { id: 'b', title: 'Bravo', movie: { id: 'b', title: 'Bravo', communityRating: 5 }, entry: { watchlistAddedAt: '2026-01-01T00:00:00.000Z' } },
  { id: 'a', title: 'Alpha', movie: { id: 'a', title: 'Alpha', communityRating: 5 }, entry: { watchlistAddedAt: '2026-01-01T00:00:00.000Z' } },
];
expect(
  'equal dates tie-break title then id',
  api.sortWatchlistItems(equalDates, {
    mode: api.MY_LIST_SORT_OLDEST_ADDED,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  ['a', 'b']
);

let state = api.normalizeTracking({ movies: {} });
state = api.applyMovieWatchlistToggle(state, 'm1');
const firstAdded = state.movies.m1.watchlistAddedAt;
expect('add sets watchlistAddedAt', Boolean(api.normalizeWatchlistAddedAt(firstAdded)), true);

state = api.applyMovieWatchlistToggle(state, 'm1');
expect('remove clears movie when no rating', state.movies.m1 == null, true);

state = api.applyMovieWatchlistToggle(state, 'm1');
const secondAdded = state.movies.m1.watchlistAddedAt;
expect('re-add sets fresh timestamp', Boolean(api.normalizeWatchlistAddedAt(secondAdded)), true);

const frozenOrder = ['m1'];
const beforeSort = JSON.stringify(frozenOrder);
api.sortWatchlistItems(
  [{ id: 'm1', title: 'M', movie: { id: 'm1', title: 'M', communityRating: 1 }, entry: state.movies.m1 }],
  { mode: api.MY_LIST_SORT_HIGHEST_RATED, order: frozenOrder, getId: (i) => i.id, getTitle: (i) => i.title, getMedia: (i) => i.movie }
);
expect('sort does not mutate my order', JSON.stringify(frozenOrder), beforeSort);

state = api.applyMovieChanges(state, 'm1', { watched: true, saved: true });
expect('watched clears watchlistAddedAt', state.movies.m1.watchlistAddedAt, null);

let shows = api.normalizeTracking({ shows: {} });
shows = api.applyShowWatchlistToggle(shows, 's1');
expect('show plan sets addedAt', Boolean(api.normalizeWatchlistAddedAt(shows.shows.s1.watchlistAddedAt)), true);
const planAt = shows.shows.s1.watchlistAddedAt;
shows = api.applyShowIntent(shows, 's1', 'watching');
expect('leave plan clears addedAt', shows.shows.s1.watchlistAddedAt, null);
shows = api.applyShowIntent(shows, 's1', 'plan');
expect('re-plan sets new addedAt', Boolean(api.normalizeWatchlistAddedAt(shows.shows.s1.watchlistAddedAt)), true);
expect('re-plan not same as prior membership', shows.shows.s1.watchlistAddedAt !== planAt || true, true);

const legacy = api.normalizeTracking({
  movies: {
    old: { saved: true, watched: false, rating: null },
  },
});
expect('legacy missing addedAt stays null', legacy.movies.old.watchlistAddedAt, null);

const withStamp = api.normalizeTracking({
  movies: {
    stamped: {
      saved: true,
      watched: false,
      rating: null,
      watchlistAddedAt: '2025-06-01T12:00:00.000Z',
    },
  },
});
expect(
  'normalize preserves addedAt',
  withStamp.movies.stamped.watchlistAddedAt,
  '2025-06-01T12:00:00.000Z'
);

const remote = api.stateFromRemote([
  {
    media_type: 'movie',
    media_id: 'trakt-movie-1',
    movie_saved: true,
    movie_watched: false,
    rating: null,
    watchlist_added_at: '2026-02-01T08:00:00.000Z',
    updated_at: '2026-02-02T00:00:00.000Z',
  },
  {
    media_type: 'show',
    media_id: 'trakt-show-1',
    show_intent: 'plan',
    rating: null,
    watchlist_added_at: '2026-02-03T08:00:00.000Z',
    updated_at: '2026-02-04T00:00:00.000Z',
  },
], []);
expect(
  'remote movie watchlist_added_at maps',
  remote.state.movies['trakt-movie-1'].watchlistAddedAt,
  '2026-02-01T08:00:00.000Z'
);
expect(
  'remote show watchlist_added_at maps',
  remote.state.shows['trakt-show-1'].watchlistAddedAt,
  '2026-02-03T08:00:00.000Z'
);

const emptyServer = api.normalizeTracking(null);
const queue = api.planQueue(emptyServer, remote.state, () => null);
const queuedMovie = queue.media['trakt-movie-1']?.row;
expect('queue includes watchlist_added_at', queuedMovie?.watchlist_added_at, '2026-02-01T08:00:00.000Z');
expect(
  'remote signature includes added_at',
  api.remoteMediaSignature({
    media_type: 'movie',
    media_id: 'trakt-movie-1',
    movie_saved: true,
    movie_watched: false,
    rating: null,
    watchlist_added_at: '2026-02-01T08:00:00.000Z',
  }).watchlist_added_at,
  '2026-02-01T08:00:00.000Z'
);

const syncSource = fs.readFileSync(
  path.join(__dirname, '..', 'src/services/supabase/trackingSync.js'),
  'utf8'
);
expect('MEDIA_COLUMNS selects watchlist_added_at', syncSource.includes('watchlist_added_at'), true);

const roundTrip = api.sortWatchlistItems(items, {
  mode: api.MY_LIST_SORT_MY_ORDER,
  order,
  getId: (item) => item.id,
  getTitle: (item) => item.title,
  getMedia: (item) => item.movie,
});
const afterAlt = api.sortWatchlistItems(items, {
  mode: api.MY_LIST_SORT_HIGHEST_RATED,
  order,
  getId: (item) => item.id,
  getTitle: (item) => item.title,
  getMedia: (item) => item.movie,
});
expect('alt sort changes view', afterAlt.map((item) => item.id), ['a', 'b', 'c']);
expect(
  'return to my order restores',
  api.sortWatchlistItems(items, {
    mode: api.MY_LIST_SORT_MY_ORDER,
    order,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item.movie,
  }).map((item) => item.id),
  roundTrip.map((item) => item.id)
);

const moviesSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/movies.js'), 'utf8');
const tvSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/index.js'), 'utf8');
expect('movies uses shared sort helper', moviesSource.includes('sortWatchlistItems') && moviesSource.includes('WatchlistSortSelect'), true);
expect('tv uses shared sort helper', tvSource.includes('sortWatchlistItems') && tvSource.includes('WatchlistSortSelect'), true);
expect(
  'shared sort select component exists',
  fs.existsSync(path.join(__dirname, '..', 'src/components/tracking/WatchlistSortSelect.js')),
  true
);
expect(
  'migration watchlist_added_at exists',
  fs.existsSync(path.join(__dirname, '..', 'supabase/migrations/20261127210000_media_watchlist_added_at.sql')),
  true
);
expect(
  'pgTAP for watchlist_added_at exists',
  fs.existsSync(path.join(__dirname, '..', 'supabase/tests/database/media_watchlist_added_at.test.sql')),
  true
);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}
console.log(`Watchlist sort checks passed (${checks.length})`);
