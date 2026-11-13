const fs = require('fs');
const path = require('path');

function loadModule(relativePath, returned) {
  const file = path.join(__dirname, '..', relativePath);
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/^export \{[^}]+\};?\s*$/gm, '');
  code = code.replace(/^export /gm, '');
  return new Function(`${code}\nreturn { ${returned} };`)();
}

const status = loadModule('src/tracking/status.js', [
  'deriveShowStatus',
  'getNextEpisode',
  'getProgress',
  'releasedEpisodes',
  'watchedThroughIds',
  'dateKey',
  'upcomingForShows',
].join(', '));

const catalog = loadModule('src/data/catalog.js', 'shows, getShow');
const TODAY = status.dateKey();

function entry(intent, ids) {
  return { intent, watchedEpisodeIds: ids, rating: null };
}

function ids(show, count, season = 1) {
  return show.seasons
    .find((item) => item.season === season)
    .episodes.slice(0, count)
    .map((episode) => episode.id);
}

const harbor = catalog.getShow('harbor-lights');
const northline = catalog.getShow('northline');
const glass = catalog.getShow('glass-archive');
const ember = catalog.getShow('ember-court');
const kinfolk = catalog.getShow('kinfolk');

const checks = [];
function expect(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, pass, actual, expected });
}

const harborEntry = entry('watching', ids(harbor, 4));
expect('harbor watching', status.deriveShowStatus(harbor, harborEntry, TODAY), 'watching');
expect('harbor next', status.getNextEpisode(harbor, harborEntry, TODAY).id, 'harbor-lights-s1e5');

const releasedHarbor = status.releasedEpisodes(harbor, TODAY).map((episode) => episode.id);
const caughtUp = entry('watching', releasedHarbor);
expect('harbor caught up', status.deriveShowStatus(harbor, caughtUp, TODAY), 'caughtUp');
expect('harbor no next when caught up', status.getNextEpisode(harbor, caughtUp, TODAY), null);

const emberEntry = entry('watching', ids(ember, 6));
expect('ember completed', status.deriveShowStatus(ember, emberEntry, TODAY), 'completed');
const emberPartial = entry('watching', ids(ember, 5));
expect('ended with leftovers stays watching', status.deriveShowStatus(ember, emberPartial, TODAY), 'watching');

expect('glass caught up', status.deriveShowStatus(glass, entry('watching', ids(glass, 6)), TODAY), 'caughtUp');
expect('dropped stays dropped', status.deriveShowStatus(kinfolk, entry('dropped', ids(kinfolk, 3)), TODAY), 'dropped');
expect('plan stays plan', status.deriveShowStatus(northline, entry('plan', ids(northline, 2)), TODAY), 'plan');

const through = status.watchedThroughIds(harbor, 'harbor-lights-s1e3', TODAY);
expect('watched through includes earlier episodes', through, ids(harbor, 3));

const undone = entry('watching', harborEntry.watchedEpisodeIds.filter((id) => id !== 'harbor-lights-s1e4'));
expect('undo restores previous next episode', status.getNextEpisode(harbor, undone, TODAY).id, 'harbor-lights-s1e4');

const northEntry = entry('watching', [...ids(northline, 6, 1), ...ids(northline, 1, 2)]);
expect('northline still watching', status.deriveShowStatus(northline, northEntry, TODAY), 'watching');
expect('northline next is s2e2', status.getNextEpisode(northline, northEntry, TODAY).id, 'northline-s2e2');

const upcoming = status.upcomingForShows(
  [
    { show: harbor },
    { show: northline },
    { show: glass },
  ],
  TODAY
);
expect('unreleased harbor episode is upcoming', upcoming.some((item) => item.id === 'harbor-lights-s1e7' && item.kind === 'episode'), true);
expect('released harbor episode is not upcoming', upcoming.some((item) => item.id === 'harbor-lights-s1e5'), false);
expect('glass season premiere is a new season', upcoming.find((item) => item.id === 'glass-archive-s2e1').kind, 'season');
expect('undated items sort after dated items', status.upcomingForShows([{ show: { seasons: [{ season: 1, episodes: [{ id: 'tba', season: 1, number: 1, airDate: null }, { id: 'dated', season: 1, number: 2, airDate: '2099-01-01' }] }] } }], TODAY).map((item) => item.id), ['dated', 'tba']);

const en = require('../src/i18n/locales/en.json');

function hasKey(key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), en) != null;
}

catalog.shows.forEach((show) => {
  [show.titleKey, show.synopsisKey].forEach((key) => {
    expect(`key ${key}`, hasKey(key), true);
  });
  show.seasons.forEach((season) => {
    season.episodes.forEach((episode) => {
      expect(`key ${episode.titleKey}`, hasKey(episode.titleKey), true);
    });
  });
});

const movies = loadModule('src/data/catalog.js', 'movies').movies;
movies.forEach((movie) => {
  [movie.titleKey, movie.synopsisKey, movie.genreKey].forEach((key) => {
    expect(`key ${key}`, hasKey(key), true);
  });
});
const watchlist = loadModule('src/tracking/watchlist.js', [
  'applyShowWatchlistToggle',
  'applyMovieWatchlistToggle',
  'migrateFavorites',
  'isShowWatchlisted',
  'isMovieWatchlisted',
  'showBookmarkVisible',
  'movieBookmarkVisible',
].join(', '));

const base = {
  shows: {
    'harbor-lights': { intent: 'watching', watchedEpisodeIds: ['harbor-lights-s1e1'], rating: 8 },
  },
  movies: {
    'golden-hour': { saved: true, watched: true, rating: 9 },
  },
  showRatings: { 'paper-saints': 7 },
  episodeRatings: { 'harbor-lights-s1e1': 9 },
  favorites: {
    shows: { 'harbor-lights': true, afterglow: true },
    movies: { 'golden-hour': true, 'low-orbit': true },
  },
};
const migrated = watchlist.migrateFavorites(base);
expect('favorite show already watching stays watching', migrated.shows['harbor-lights'], base.shows['harbor-lights']);
expect('favorite-only show becomes plan', migrated.shows.afterglow.intent, 'plan');
expect('favorite-only show has no watched episodes', migrated.shows.afterglow.watchedEpisodeIds, []);
expect('watched favorite movie stays watched', migrated.movies['golden-hour'], base.movies['golden-hour']);
expect('favorite-only movie is to watch', migrated.movies['low-orbit'], { saved: true, watched: false, rating: null });
const migratedAgain = watchlist.migrateFavorites({ ...base, ...migrated, favorites: undefined });
expect('migration does not duplicate a planned show', migratedAgain.shows.afterglow, migrated.shows.afterglow);

const addedShow = watchlist.applyShowWatchlistToggle({ shows: {}, showRatings: { wren: 6 }, movies: {} }, 'wren');
expect('bookmark adds a show to plan', addedShow.shows.wren.intent, 'plan');
expect('bookmark keeps a show rating', addedShow.shows.wren.rating, 6);
const watchingUntouched = watchlist.applyShowWatchlistToggle(base, 'harbor-lights');
expect('bookmark does not reset a watching show', watchingUntouched.shows['harbor-lights'], base.shows['harbor-lights']);
const removedPlan = watchlist.applyShowWatchlistToggle(addedShow, 'wren');
expect('bookmark removes a planned show', removedPlan.shows.wren, undefined);
expect('removing a planned show keeps its rating', removedPlan.showRatings.wren, 6);

const addedMovie = watchlist.applyMovieWatchlistToggle({ movies: { rated: { saved: false, watched: false, rating: 4 } } }, 'rated');
expect('bookmark saves a movie to watch', watchlist.isMovieWatchlisted(addedMovie.movies.rated), true);
expect('bookmark keeps a movie rating', addedMovie.movies.rated.rating, 4);
const watchedUntouched = watchlist.applyMovieWatchlistToggle(base, 'golden-hour');
expect('bookmark does not reset a watched movie', watchedUntouched.movies['golden-hour'], base.movies['golden-hour']);
expect('watched movie hides the bookmark', watchlist.movieBookmarkVisible(base.movies['golden-hour']), false);
expect('watching show hides the bookmark', watchlist.showBookmarkVisible(base.shows['harbor-lights']), false);
expect('planned show shows a filled bookmark', watchlist.isShowWatchlisted(addedShow.shows.wren), true);
const removedMovie = watchlist.applyMovieWatchlistToggle(addedMovie, 'rated');
expect('bookmark removes a to-watch movie', removedMovie.movies.rated.saved, false);
expect('removing a to-watch movie keeps its rating', removedMovie.movies.rated.rating, 4);

expect('watchlist add label', hasKey('watchlist.add'), true);
expect('watchlist remove label', hasKey('watchlist.remove'), true);
expect('show watchlist action', hasKey('tv.addToWatchlist'), true);
expect('movie watchlist action', hasKey('movies.removeFromWatchlist'), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(`Tracking checks passed (${checks.length})`);
console.log(`Harbor released on ${TODAY}: ${releasedHarbor.length}`);
console.log(`Catalog shows: ${catalog.shows.length}`);
