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
const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(`Tracking checks passed (${checks.length})`);
console.log(`Harbor released on ${TODAY}: ${releasedHarbor.length}`);
console.log(`Catalog shows: ${catalog.shows.length}`);
