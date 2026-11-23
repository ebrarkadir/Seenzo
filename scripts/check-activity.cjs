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
    'src/tracking/activityEvents.js',
    'src/insights/calculateActivity.js',
  ],
  [
    'createActivityEvent',
    'createClientEventId',
    'normalizeActivityEvents',
    'appendActivityEvents',
    'mergeActivityEvents',
    'pendingActivityEvents',
    'acknowledgeActivityEvents',
    'isChartEligibleActivity',
    'buildMovieActivityEvents',
    'buildEpisodeActivityEvents',
    'calculateMonthlyActivity',
    'calculateActivitySummary',
    'listActivityYears',
    'buildViewingActivity',
  ].join(', ')
);

const movieWatched = api.createActivityEvent({
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
  action: 'watched',
  source: 'individual',
  clientLoggedAt: '2026-03-15T12:00:00.000Z',
  clientEventId: '11111111-1111-4111-8111-111111111111',
  serverRecordedAt: '2026-03-15T12:00:05.000Z',
});
expect('new movie watched event', Boolean(movieWatched && movieWatched.action === 'watched'), true);

const episodeWatched = api.createActivityEvent({
  mediaType: 'episode',
  mediaId: 'trakt-episode-9',
  showMediaId: 'trakt-show-2',
  action: 'watched',
  source: 'individual',
  clientLoggedAt: '2026-03-16T08:00:00.000Z',
  clientEventId: '22222222-2222-4222-8222-222222222222',
  serverRecordedAt: '2026-03-16T08:00:04.000Z',
});
expect('new episode watched event', Boolean(episodeWatched && episodeWatched.mediaType === 'episode'), true);

const aprilMovie = api.createActivityEvent({
  mediaType: 'movie',
  mediaId: 'trakt-movie-2',
  action: 'watched',
  source: 'individual',
  clientLoggedAt: '2026-04-02T10:00:00.000Z',
  clientEventId: '33333333-3333-4333-8333-333333333333',
  serverRecordedAt: '2026-04-02T10:00:01.000Z',
});

const bulk = api.buildEpisodeActivityEvents({
  showId: 'trakt-show-2',
  episodeIds: ['trakt-episode-1', 'trakt-episode-2', 'trakt-episode-3'],
  action: 'watched',
  source: 'season_bulk',
  now: '2026-03-20T12:00:00.000Z',
});
expect('bulk creates three events', bulk.length, 3);
expect('bulk events are not chart eligible', bulk.every((event) => !api.isChartEligibleActivity(event)), true);

const undoEvent = api.createActivityEvent({
  mediaType: 'episode',
  mediaId: 'trakt-episode-9',
  showMediaId: 'trakt-show-2',
  action: 'unwatched',
  source: 'undo',
  clientLoggedAt: '2026-03-16T09:00:00.000Z',
  clientEventId: '44444444-4444-4444-8444-444444444444',
});
expect('undo is not chart eligible', api.isChartEligibleActivity(undoEvent), false);

const events = [movieWatched, episodeWatched, aprilMovie, ...bulk, undoEvent];
const monthly = api.calculateMonthlyActivity(events, { year: 2026, filter: 'all', timeZone: 'UTC' });
expect('march total ignores bulk', monthly.months[2].total, 2);
expect('march movies', monthly.months[2].movies, 1);
expect('march episodes', monthly.months[2].episodes, 1);
expect('april movies', monthly.months[3].movies, 1);
expect('january zero', monthly.months[0].total, 0);

const movieOnly = api.calculateMonthlyActivity(events, { year: 2026, filter: 'movie', timeZone: 'UTC' });
expect('movie filter march', movieOnly.months[2].total, 1);
expect('movie filter april', movieOnly.months[3].total, 1);

const episodeOnly = api.calculateMonthlyActivity(events, { year: 2026, filter: 'episode', timeZone: 'UTC' });
expect('episode filter march', episodeOnly.months[2].total, 1);
expect('episode filter april', episodeOnly.months[3].total, 0);

const years = api.listActivityYears(events, { timeZone: 'UTC' });
expect('year selection', years, [2026]);

const summary = api.calculateActivitySummary(events, { year: 2026, filter: 'all', timeZone: 'UTC' });
expect('active days', summary.activeDays, 3);
expect('movies logged', summary.moviesLogged, 2);
expect('episodes logged', summary.episodesLogged, 1);

const duplicateRetry = api.normalizeActivityEvents([
  movieWatched,
  { ...movieWatched, serverRecordedAt: null },
  { ...movieWatched, clientLoggedAt: '2026-03-15T12:00:00.000Z' },
]);
expect('duplicate offline retries collapse', duplicateRetry.length, 1);
expect('duplicate keeps server stamp', Boolean(duplicateRetry[0].serverRecordedAt), true);

const pending = api.pendingActivityEvents({
  activityEvents: [
    movieWatched,
    {
      ...episodeWatched,
      serverRecordedAt: null,
    },
  ],
});
expect('pending excludes synced', pending.map((event) => event.clientEventId), [
  '22222222-2222-4222-8222-222222222222',
]);

const acknowledged = api.acknowledgeActivityEvents(
  { activityEvents: pending },
  [{ clientEventId: pending[0].clientEventId, serverRecordedAt: '2026-03-16T08:00:09.000Z' }]
);
expect(
  'ack stores server timestamp',
  acknowledged.activityEvents[0].serverRecordedAt,
  '2026-03-16T08:00:09.000Z'
);

const unwatch = api.buildMovieActivityEvents('trakt-movie-1', {
  watchedBefore: true,
  watchedAfter: false,
  now: '2026-05-01T00:00:00.000Z',
});
expect('unwatch emits unwatched', unwatch[0]?.action, 'unwatched');
expect('unwatch not chart eligible', api.isChartEligibleActivity(unwatch[0]), false);

const rewatch = api.buildMovieActivityEvents('trakt-movie-1', {
  watchedBefore: false,
  watchedAfter: true,
  now: '2026-05-02T00:00:00.000Z',
});
expect('rewatch emits watched', rewatch[0]?.action, 'watched');

const empty = api.buildViewingActivity([], { timeZone: 'UTC' });
expect('empty activity', empty.hasLoggingEvents, false);
expect('empty years', empty.years, []);

const noFabrication = api.buildViewingActivity(
  [
    {
      mediaType: 'movie',
      mediaId: 'trakt-movie-9',
      action: 'watched',
      source: 'individual',
      clientLoggedAt: '2020-01-01T00:00:00.000Z',
      // missing clientEventId -> dropped
    },
  ],
  { timeZone: 'UTC' }
);
expect('invalid historical rows are dropped', noFabrication.hasLoggingEvents, false);

const boundary = api.calculateMonthlyActivity(
  [
    api.createActivityEvent({
      mediaType: 'movie',
      mediaId: 'trakt-movie-8',
      action: 'watched',
      source: 'individual',
      clientLoggedAt: '2026-01-01T00:30:00.000Z',
      clientEventId: '55555555-5555-4555-8555-555555555555',
      serverRecordedAt: '2026-01-01T00:30:00.000Z',
    }),
  ],
  { year: 2025, filter: 'all', timeZone: 'America/Los_Angeles' }
);
expect('timezone month boundary uses local calendar', boundary.months[11].total, 1);

const accountA = api.mergeActivityEvents([movieWatched], []);
const accountB = api.mergeActivityEvents([episodeWatched], []);
expect('account isolation merge a', accountA.map((event) => event.mediaId), ['trakt-movie-1']);
expect('account isolation merge b', accountB.map((event) => event.mediaId), ['trakt-episode-9']);

const appendOnce = api.appendActivityEvents({ activityEvents: [movieWatched] }, [movieWatched]);
expect('append dedupes identical event', appendOnce.activityEvents.length, 1);

const dashboard = api.buildViewingActivity(events, { year: 2026, filter: 'all', timeZone: 'UTC' });
expect('dashboard historical incomplete flag', dashboard.historicalIncomplete, true);
expect('dashboard selected year', dashboard.selectedYear, 2026);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Activity checks passed (${checks.length})`);
