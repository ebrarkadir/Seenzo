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

function loadModule(relativePath, returned) {
  return loadModules([relativePath], returned);
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
const progress = loadModules(
  ['src/tracking/status.js', 'src/tracking/progress.js'],
  'markNextReleased, toggleReleasedEpisode, undoAddedEpisodes, undoEpisodeChanges, markSeasonWatched, markSeasonUnwatched, deriveShowStatus, getNextEpisode, getProgress, getSeasonProgress, listShowSeasons, releasedEpisodes'
);

function episode(id, season, number, airDate) {
  return { id, season, number, airDate };
}

const series = {
  releaseStatus: 'returning',
  seasons: [
    {
      season: 0,
      episodeCount: 5,
      episodes: [episode('special', 0, 1, '2020-01-01')],
    },
    {
      season: 2,
      episodeCount: 99,
      episodes: [
        episode('s2e1', 2, 1, '2024-01-01'),
        episode('s2future', 2, 2, '2099-01-01'),
      ],
    },
    {
      season: 1,
      episodeCount: 99,
      episodes: [
        episode('s1e1', 1, 1, '2023-01-01'),
        episode('s1missing', 1, 2, null),
        episode('s1e3', 1, 3, '2023-02-01'),
        episode('s1e3', 1, 3, '2023-02-01'),
      ],
    },
  ],
};
const releasedIds = progress.releasedEpisodes(series, TODAY).map((item) => item.id);
expect('released order skips specials, duplicates, undated and future episodes', releasedIds, ['s1e1', 's1e3', 's2e1']);
expect('episode count metadata does not inflate progress', progress.getProgress(series, { watchedEpisodeIds: [] }, TODAY).total, 3);
expect('future ids already stored are not counted', progress.getProgress(series, { watchedEpisodeIds: ['s1e1', 's1e1', 's2future', 'special'] }, TODAY).watched, 1);

let cursor = { intent: 'watching', watchedEpisodeIds: [], rating: 8 };
const first = progress.markNextReleased(series, cursor, TODAY);
cursor = first.entry;
expect('mark watched starts at the first released episode', first.marked.id, 's1e1');
const second = progress.markNextReleased(series, cursor, TODAY);
cursor = second.entry;
expect('mark watched skips the undated episode', second.marked.id, 's1e3');
const third = progress.markNextReleased(series, cursor, TODAY);
cursor = third.entry;
expect('mark watched crosses into the next season', third.marked.id, 's2e1');
expect('all released episodes are caught up', progress.deriveShowStatus(series, cursor, TODAY), 'caughtUp');
expect('caught up has no next episode', progress.getNextEpisode(series, cursor, TODAY), null);
const repeated = progress.markNextReleased(series, cursor, TODAY);
expect('mark watched does not duplicate the last episode', repeated.added, []);

const rewound = progress.toggleReleasedEpisode(series, cursor, 's1e3', TODAY);
expect('unwatching removes that episode and later progress', rewound.entry.watchedEpisodeIds, ['s1e1']);
expect('next episode is restored', progress.getNextEpisode(series, rewound.entry, TODAY).id, 's1e3');
const restoredEpisode = progress.undoAddedEpisodes(third.entry, third.added, third.previousIntent);
expect('undo restores the previous episode', progress.getNextEpisode(series, restoredEpisode, TODAY).id, 's2e1');

const planned = { intent: 'plan', watchedEpisodeIds: [], rating: null };
const started = progress.markNextReleased(series, planned, TODAY);
expect('the first mark moves a planned show to watching', started.entry.intent, 'watching');
const planRestored = progress.undoAddedEpisodes(started.entry, started.added, started.previousIntent);
expect('undo restores plan to watch', planRestored.intent, 'plan');
expect('undo clears the episode that was just marked', planRestored.watchedEpisodeIds, []);

const dropped = { intent: 'dropped', watchedEpisodeIds: [], rating: 6 };
const droppedMark = progress.markNextReleased(series, dropped, TODAY);
expect('dropped stays dropped while an episode is marked', progress.deriveShowStatus(series, droppedMark.entry, TODAY), 'dropped');
const resumed = { ...droppedMark.entry, intent: 'watching' };
expect('resume uses the same episode progress', progress.deriveShowStatus(series, resumed, TODAY), 'watching');

const specialMark = progress.toggleReleasedEpisode(series, { intent: 'watching', watchedEpisodeIds: ['s1e1'], rating: null }, 'special', TODAY);
expect('a special does not change the next regular episode', progress.getNextEpisode(series, specialMark.entry, TODAY).id, 's1e3');
const futureToggle = progress.toggleReleasedEpisode(series, cursor, 's2future', TODAY);
expect('a future episode cannot be marked watched', futureToggle.added, []);
const missingToggle = progress.toggleReleasedEpisode(series, cursor, 's1missing', TODAY);
expect('an episode without an air date cannot be marked watched', missingToggle.added, []);

const ended = { ...series, releaseStatus: 'ended' };
expect('ended show with every released episode watched is completed', progress.deriveShowStatus(ended, cursor, TODAY), 'completed');
expect('ended show with no released episodes stays watching', progress.deriveShowStatus({ releaseStatus: 'ended', seasons: [] }, { intent: 'watching', watchedEpisodeIds: [] }, TODAY), 'watching');
const hole = progress.toggleReleasedEpisode(series, { intent: 'watching', watchedEpisodeIds: [], rating: null }, 's2e1', TODAY);
expect('checking a later episode fills the earlier released episodes', hole.entry.watchedEpisodeIds, ['s1e1', 's1e3', 's2e1']);

const fromScratch = progress.toggleReleasedEpisode(series, null, 's1e1', TODAY);
expect('the first watched episode starts active tracking', fromScratch.entry.intent, 'watching');
expect('season list keeps specials and regular seasons', progress.listShowSeasons(series), [0, 1, 2]);
expect('season 1 progress ignores undated episodes', progress.getSeasonProgress(series, { watchedEpisodeIds: ['s1e1'] }, 1, TODAY), { watched: 1, total: 2 });
const seasonMarked = progress.markSeasonWatched(series, { intent: 'plan', watchedEpisodeIds: [], rating: null }, 1, TODAY);
expect('mark season watched promotes a plan show', seasonMarked.entry.intent, 'watching');
expect('mark season watched only marks released episodes', seasonMarked.entry.watchedEpisodeIds, ['s1e1', 's1e3']);
expect('future season episodes stay unwatched', seasonMarked.added.includes('s2future') || seasonMarked.entry.watchedEpisodeIds.includes('s2future'), false);
const seasonCleared = progress.markSeasonUnwatched(series, seasonMarked.entry, 1, TODAY);
expect('mark season unwatched clears that season only', seasonCleared.entry.watchedEpisodeIds, []);
const seasonUndo = progress.undoEpisodeChanges(seasonCleared.entry, {
  added: seasonCleared.added,
  removed: seasonCleared.removed,
  previousIntent: seasonCleared.previousIntent,
});
expect('undo restores the season that was cleared', seasonUndo.watchedEpisodeIds, ['s1e1', 's1e3']);
const droppedSeason = progress.markSeasonWatched(series, { intent: 'dropped', watchedEpisodeIds: [], rating: null }, 1, TODAY);
expect('dropped stays dropped after marking a season', droppedSeason.entry.intent, 'dropped');
const specialSeason = progress.markSeasonWatched(series, { intent: 'watching', watchedEpisodeIds: ['s1e1'], rating: null }, 0, TODAY);
expect('specials do not clear regular progress', specialSeason.entry.watchedEpisodeIds.sort(), ['s1e1', 'special'].sort());

const watchlist = loadModule('src/tracking/watchlist.js', [
  'applyShowWatchlistToggle',
  'applyMovieWatchlistToggle',
  'migrateFavorites',
  'isShowWatchlisted',
  'isMovieWatchlisted',
  'showBookmarkVisible',
  'movieBookmarkVisible',
  'normalizeTracking',
  'applyMovieChanges',
  'applyShowRating',
  'applyEpisodeRating',
  'applyMovieRating',
  'applyShowIntent',
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

let movieState = { movies: {}, shows: {}, showRatings: {}, episodeRatings: {} };
movieState = watchlist.applyMovieWatchlistToggle(movieState, 'trakt-movie-9');
movieState = watchlist.applyMovieChanges(movieState, 'trakt-movie-9', { watched: true, saved: true });
movieState = watchlist.applyMovieRating(movieState, 'trakt-movie-9', 8);
const ratedShow = watchlist.applyShowRating(movieState, 'trakt-show-3', 7);
const ratedEpisode = watchlist.applyEpisodeRating(ratedShow, 'trakt-episode-4', 6);
expect('movie watch and rating stay on one record', Object.keys(ratedEpisode.movies), ['trakt-movie-9']);
expect('show rating is stored apart from the movie', ratedEpisode.showRatings['trakt-show-3'], 7);
expect('episode rating stays separate from the movie rating', ratedEpisode.episodeRatings['trakt-episode-4'], 6);
expect('movie rating stays on the movie', ratedEpisode.movies['trakt-movie-9'].rating, 8);
const unwatched = watchlist.applyMovieChanges(ratedEpisode, 'trakt-movie-9', { watched: false, saved: true });
expect('mark unwatched returns the movie to the watchlist', watchlist.isMovieWatchlisted(unwatched.movies['trakt-movie-9']), true);
expect('unwatching a movie keeps its rating', unwatched.movies['trakt-movie-9'].rating, 8);
const removed = watchlist.applyMovieWatchlistToggle(unwatched, 'trakt-movie-9');
expect('remove watchlist keeps one rated movie record', removed.movies['trakt-movie-9'].saved, false);
const resumedShow = watchlist.applyShowIntent(
  { shows: { 'trakt-show-3': { intent: 'dropped', watchedEpisodeIds: ['trakt-episode-4'], rating: 7 } }, showRatings: {} },
  'trakt-show-3',
  'watching'
);
expect('resume keeps episode progress', resumedShow.shows['trakt-show-3'].watchedEpisodeIds, ['trakt-episode-4']);

const stored = {
  onboardingComplete: true,
  demoMode: false,
  shows: {
    'trakt-show-3': {
      intent: 'watching',
      watchedEpisodeIds: ['trakt-episode-4', 'trakt-episode-4', 12],
      rating: 7,
    },
  },
  movies: {
    'trakt-movie-9': { saved: true, watched: true, rating: 8 },
  },
  showRatings: { 'trakt-show-3': 1 },
  episodeRatings: { 'trakt-episode-4': 6, bad: 12 },
  favorites: { shows: { 'trakt-show-3': true, 'trakt-show-8': true }, movies: {} },
};
const restored = watchlist.normalizeTracking(JSON.parse(JSON.stringify(stored)));
expect('restart keeps episode progress without duplicates', restored.shows['trakt-show-3'].watchedEpisodeIds, ['trakt-episode-4']);
expect('restart keeps the show rating', restored.shows['trakt-show-3'].rating, 7);
expect('restart keeps the movie record', restored.movies['trakt-movie-9'], { saved: true, watched: true, rating: 8 });
expect('restart keeps a valid episode rating', restored.episodeRatings['trakt-episode-4'], 6);
expect('restart drops an invalid episode rating', restored.episodeRatings.bad, undefined);
expect('favorite-only show is restored once', restored.shows['trakt-show-8'].intent, 'plan');
const restoredAgain = watchlist.normalizeTracking(JSON.parse(JSON.stringify(restored)));
expect('a second restore does not duplicate the show', Object.keys(restoredAgain.shows).sort(), ['trakt-show-3', 'trakt-show-8']);

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
