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
  ['src/tracking/watchlistOrder.js', 'src/tracking/watchlistSort.js', 'src/tracking/watchlist.js'],
  [
    'moveWatchlistId',
    'reorderWatchlistIds',
    'appendWatchlistId',
    'removeWatchlistId',
    'reconcileOrderArray',
    'reconcileWatchlistOrders',
    'applyMovieWatchlistOrderMove',
    'applyShowWatchlistOrderMove',
    'applyMovieWatchlistReorder',
    'applyMovieWatchlistToggle',
    'applyShowWatchlistToggle',
    'applyShowIntent',
    'applyMovieChanges',
    'normalizeTracking',
    'uniqueOrderIds',
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

const ten = Array.from({ length: 10 }, (_, index) => `m${index + 1}`);
const move10to2 = api.moveWatchlistId(ten, 'm10', 2);
expect('10 → 2', move10to2.order, ['m1', 'm10', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
expect('10 → 2 ok', move10to2.ok, true);

const move2to10 = api.moveWatchlistId(move10to2.order, 'm10', 10);
expect('2 → 10', move2to10.order, ten);
expect('2 → 10 ok', move2to10.ok, true);

const firstToLast = api.moveWatchlistId(ten, 'm1', 10);
expect('first → last', firstToLast.order, ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm1']);

const lastToFirst = api.moveWatchlistId(ten, 'm10', 1);
expect('last → first', lastToFirst.order, ['m10', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);

const invalid = api.moveWatchlistId(ten, 'm5', 0);
expect('invalid position rejected', invalid.ok, false);
expect('invalid keeps order', invalid.order, ten);

const decimal = api.moveWatchlistId(ten, 'm5', 2.5);
expect('decimal rejected', decimal.ok, false);

const long = Array.from({ length: 64 }, (_, index) => `x${index + 1}`);
const searchMove = api.moveWatchlistId(long, 'x64', 1);
expect('search-style 64 → 1', searchMove.order[0], 'x64');
expect('search-style densifies', searchMove.order.length, 64);

const dup = api.uniqueOrderIds(['a', 'b', 'a', 'c']);
expect('duplicates removed', dup, ['a', 'b', 'c']);

const frozen = JSON.stringify(ten);
api.moveWatchlistId(ten, 'm3', 1);
expect('move does not mutate input', JSON.stringify(ten), frozen);

const append = api.appendWatchlistId(['a', 'b'], 'c');
expect('append new', append, ['a', 'b', 'c']);
expect('append existing no-op', api.appendWatchlistId(append, 'b'), ['a', 'b', 'c']);

const removed = api.removeWatchlistId(['a', 'b', 'c'], 'b');
expect('remove id', removed, ['a', 'c']);

const reconciled = api.reconcileOrderArray(['z', 'a', 'gone', 'a'], ['a', 'b', 'z']);
expect('reconcile drops orphans keeps order appends missing', reconciled, ['z', 'a', 'b']);

let state = api.normalizeTracking({
  movies: {
    m1: { saved: true, watched: false, rating: null },
    m2: { saved: true, watched: false, rating: null },
    m3: { saved: true, watched: false, rating: null },
  },
  movieWatchlistOrder: ['m1', 'm2', 'm3'],
});
const moved = api.applyMovieWatchlistOrderMove(state, 'm3', 1);
expect('state move 3 → 1', moved.state.movieWatchlistOrder, ['m3', 'm1', 'm2']);
expect('state move marks dirty', moved.state.watchlistOrderMeta.movie.dirty, true);

const watched = api.applyMovieChanges(moved.state, 'm3', { watched: true, saved: true });
expect('watched removes from order', watched.movieWatchlistOrder, ['m1', 'm2']);

const added = api.applyMovieWatchlistToggle(watched, 'm9');
expect('new movie appends', added.movieWatchlistOrder, ['m1', 'm2', 'm9']);

let shows = api.normalizeTracking({
  shows: {
    s1: { intent: 'plan', watchedEpisodeIds: [], rating: null },
    s2: { intent: 'plan', watchedEpisodeIds: [], rating: null },
  },
  showWatchlistOrder: ['s1', 's2'],
  movies: { m1: { saved: true, watched: false, rating: null } },
  movieWatchlistOrder: ['m1'],
});
const showMoved = api.applyShowWatchlistOrderMove(shows, 's2', 1);
expect('show order independent', showMoved.state.showWatchlistOrder, ['s2', 's1']);
expect('movie order untouched', showMoved.state.movieWatchlistOrder, ['m1']);

const dropped = api.applyShowIntent(showMoved.state, 's2', 'dropped');
expect('dropped leaves plan order', dropped.showWatchlistOrder, ['s1']);

const reordered = api.applyMovieWatchlistReorder(
  api.normalizeTracking({
    movies: {
      a: { saved: true, watched: false, rating: null },
      b: { saved: true, watched: false, rating: null },
    },
    movieWatchlistOrder: ['a', 'b'],
  }),
  ['b', 'a']
);
expect('drag reorder', reordered.state.movieWatchlistOrder, ['b', 'a']);

const badReorder = api.reorderWatchlistIds(['a', 'b'], ['a', 'c']);
expect('reorder rejects foreign id', badReorder.ok, false);

const once = api.moveWatchlistId(ten, 'm8', 3).order;
const twice = api.moveWatchlistId(ten, 'm8', 3).order;
expect('deterministic', once, twice);

const moviesSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/movies.js'), 'utf8');
const tvSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/index.js'), 'utf8');
expect('movies has my list / for you', moviesSource.includes('MAIN_MY_LIST') && moviesSource.includes('MAIN_FOR_YOU'), true);
expect('movies has search', moviesSource.includes('watchlist.searchPlaceholder'), true);
expect('tv watchlist has ordering', tvSource.includes('reorderShowWatchlist') && tvSource.includes('WatchlistOrderRow'), true);
expect('migration exists', fs.existsSync(path.join(__dirname, '..', 'supabase/migrations/20261127200000_watchlist_order.sql')), true);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}
console.log(`Watchlist order checks passed (${checks.length})`);
