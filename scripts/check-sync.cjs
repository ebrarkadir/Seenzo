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

const sync = loadModules([
  'src/tracking/watchlist.js',
  'src/tracking/cloudState.js',
  'src/tracking/accountStore.js',
  'src/services/supabase/trackingSync.js',
], [
  'normalizeTracking',
  'accountStorageKey',
  'GUEST_TRACKING_KEY',
  'GUEST_ARCHIVE_KEY',
  'GUEST_FRESH_KEY',
  'LEGACY_TRACKING_KEY',
  'readGuestTracking',
  'readGuestSession',
  'writeGuestSession',
  'markGuestFresh',
  'isGuestFresh',
  'emptyGuestState',
  'readAccountEnvelope',
  'writeAccountEnvelope',
  'stateFromRemote',
  'mergeRemoteAndLocal',
  'planQueue',
  'queueForSync',
  'classifyChange',
  'isCurrentScope',
  'hasTrackingRecords',
  'pullTracking',
  'pushTracking',
].join(', '));

const checks = [];
function expect(name, actual, expected) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

function memory() {
  const data = {};
  return {
    data,
    getItem: async (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: async (key, value) => {
      data[key] = value;
    },
    removeItem: async (key) => {
      delete data[key];
    },
  };
}

function show(id, intent, watched = [], rating = null) {
  return {
    shows: {
      [id]: { intent, watchedEpisodeIds: watched, rating },
    },
    episodeMeta: Object.fromEntries(watched.map((episodeId) => [episodeId, {
      showId: id,
      season: 1,
      number: Number(episodeId.slice(-1)) || 1,
      watchedAt: '2026-11-14T00:00:00.000Z',
    }])),
  };
}

const remoteA = sync.stateFromRemote([
  {
    media_type: 'movie',
    media_id: 'trakt-movie-1',
    show_intent: null,
    movie_saved: true,
    movie_watched: true,
    rating: 8,
    updated_at: '2026-11-14T00:00:00.000Z',
  },
  {
    media_type: 'show',
    media_id: 'trakt-show-5',
    show_intent: 'dropped',
    movie_saved: null,
    movie_watched: null,
    rating: 7,
    updated_at: '2026-11-14T00:00:00.000Z',
  },
], [
  {
    show_media_id: 'trakt-show-5',
    episode_id: 'trakt-episode-3',
    season_number: 1,
    episode_number: 3,
    watched: true,
    rating: 9,
    watched_at: '2026-11-14T00:00:00.000Z',
    updated_at: '2026-11-14T00:00:00.000Z',
  },
]);
const remoteB = sync.stateFromRemote([], []);
const mergedB = sync.mergeRemoteAndLocal(remoteB, null, () => null);
expect('user B does not receive user A movies', mergedB.state.movies['trakt-movie-1'], undefined);
expect('empty account starts onboarding', mergedB.state.onboardingComplete, false);
expect('existing account skips onboarding', sync.mergeRemoteAndLocal(remoteA, null, () => null).state.onboardingComplete, true);
expect('restores a watched movie rating', remoteA.state.movies['trakt-movie-1'].rating, 8);
expect('restores dropped intent', remoteA.state.shows['trakt-show-5'].intent, 'dropped');
expect('restores watched episode progress', remoteA.state.shows['trakt-show-5'].watchedEpisodeIds, ['trakt-episode-3']);
expect('restores an episode rating', remoteA.state.episodeRatings['trakt-episode-3'], 9);

const skipped = sync.mergeRemoteAndLocal(remoteB, {
  state: sync.normalizeTracking({ onboardingComplete: true }),
  server: sync.normalizeTracking(null),
  stamps: { media: {}, episodes: {} },
}, () => null);
expect('skipped onboarding stays complete for that account', skipped.state.onboardingComplete, true);

const restarted = sync.mergeRemoteAndLocal(remoteA, {
  state: sync.normalizeTracking({ onboardingComplete: false }),
  server: remoteA.state,
  stamps: remoteA.stamps,
}, () => null);
expect('explicit restart still opens onboarding', restarted.state.onboardingComplete, false);

const server = sync.normalizeTracking(show('trakt-show-5', 'watching', ['trakt-episode-3']));
const removed = sync.normalizeTracking({
  showRatings: {},
  episodeMeta: server.episodeMeta,
});
const removal = sync.planQueue(server, removed, () => null);
expect('removing a show does not delete its episode history', removal.episodes['trakt-episode-3'], undefined);
expect('removing a show deletes only the show row', removal.media['trakt-show-5'].type, 'delete');

const unwatched = sync.normalizeTracking({
  shows: { 'trakt-show-5': { intent: 'watching', watchedEpisodeIds: [], rating: null } },
  episodeMeta: server.episodeMeta,
});
expect('unwatching an episode removes that episode row', sync.planQueue(server, unwatched, () => null).episodes['trakt-episode-3'].type, 'delete');

const ratedMovie = sync.normalizeTracking({
  movies: { 'trakt-movie-4': { saved: false, watched: false, rating: 4 } },
});
expect('a movie rating is queued by itself', sync.planQueue(sync.normalizeTracking(null), ratedMovie, () => null).media['trakt-movie-4'].row.rating, 4);

const demo = sync.normalizeTracking({
  shows: { 'harbor-lights': { intent: 'watching', watchedEpisodeIds: ['harbor-lights-s1e1'], rating: 9 } },
});
expect('demo ids are not uploaded', Object.keys(sync.planQueue(sync.normalizeTracking(null), demo, () => null).media).length, 0);
expect('a failed load does not plan remote deletes', Object.keys(sync.queueForSync(server, sync.normalizeTracking(null), () => null, { allowPush: false }).media).length, 0);
expect('matching state does not write duplicates', Object.keys(sync.planQueue(server, server, () => null).media).length, 0);

const pendingLocal = sync.normalizeTracking({
  shows: { 'trakt-show-9': { intent: 'plan', watchedEpisodeIds: [], rating: null } },
});
const pendingServer = sync.normalizeTracking(null);
const mergedPending = sync.mergeRemoteAndLocal(remoteB, {
  state: pendingLocal,
  server: pendingServer,
  stamps: { media: {}, episodes: {} },
}, () => null);
expect('pending offline show is kept when remote is empty', mergedPending.state.shows['trakt-show-9'].intent, 'plan');
expect('pending work is separate from another account remote', mergedPending.state.movies['trakt-movie-1'], undefined);

expect('newer remote edit is a conflict', sync.classifyChange('2026-11-14T00:00:00.000Z', '2026-11-14T01:00:00.000Z', { media_id: 'trakt-movie-1', rating: 2 }, { media_id: 'trakt-movie-1', rating: 8 }), 'conflict');
expect('unchanged remote stamp can be pushed', sync.classifyChange('2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z', { media_id: 'trakt-movie-1', rating: 2 }, { media_id: 'trakt-movie-1', rating: 8 }), 'push');
expect('stale scope is ignored', sync.isCurrentScope({ id: 2, key: 'user-b' }, { id: 1, key: 'user-a' }), false);
expect('current scope is accepted', sync.isCurrentScope({ id: 2, key: 'user-b' }, { id: 2, key: 'user-b' }), true);

(async () => {
  const storage = memory();
  storage.data[sync.LEGACY_TRACKING_KEY] = JSON.stringify({
    onboardingComplete: true,
    shows: { 'guest-show': { intent: 'plan', watchedEpisodeIds: [], rating: null } },
  });
  await sync.writeAccountEnvelope(storage, 'user-a', {
    state: remoteA.state,
    server: remoteA.state,
    stamps: remoteA.stamps,
  });
  const guest = await sync.readGuestTracking(storage);
  const accountB = await sync.readAccountEnvelope(storage, 'user-b');
  const accountA = await sync.readAccountEnvelope(storage, 'user-a');
  expect('guest data is copied without deleting the legacy key', storage.data[sync.LEGACY_TRACKING_KEY] ? true : false, true);
  expect('guest storage is separate from accounts', guest.shows['guest-show'].intent, 'plan');
  expect('guest storage does not contain account A', guest.movies['trakt-movie-1'], undefined);
  expect('account B has no cached rows', accountB, null);
  expect('account A keeps its own movie', accountA.state.movies['trakt-movie-1'].watched, true);
  expect('account keys differ', sync.accountStorageKey('user-a') === sync.accountStorageKey('user-b'), false);
  expect('guest key is not an account key', sync.GUEST_TRACKING_KEY === sync.accountStorageKey('user-a'), false);

  await sync.markGuestFresh(storage);
  const freshGuest = await sync.readGuestSession(storage);
  expect('logout uses a clean guest session', freshGuest.onboardingComplete, false);
  expect('logout does not display archived guest shows', freshGuest.shows['guest-show'], undefined);
  expect('historical guest storage remains untouched', JSON.parse(storage.data[sync.GUEST_TRACKING_KEY]).shows['guest-show'].intent, 'plan');
  expect('fresh guest flag is set', await sync.isGuestFresh(storage), true);
  const skippedWrite = await sync.writeGuestSession(storage, sync.emptyGuestState());
  expect('empty fresh guest does not overwrite history', skippedWrite.wrote, false);
  const firstGuestUse = await sync.writeGuestSession(storage, sync.normalizeTracking({ onboardingComplete: true }));
  expect('first guest use archives prior history', Boolean(storage.data[sync.GUEST_ARCHIVE_KEY]), true);
  expect('first guest use clears the fresh flag', firstGuestUse.fresh, false);
  expect('archived guest keeps the old show', JSON.parse(storage.data[sync.GUEST_ARCHIVE_KEY]).shows['guest-show'].intent, 'plan');

  function fakeClient(userId, media, episodes) {
    const filters = [];
    const query = (rows) => {
      const state = { rows, userId: null };
      const api = {
        select() { return api; },
        eq(column, value) {
          if (column === 'user_id') {
            state.userId = value;
          }
          filters.push([column, value]);
          return api;
        },
        in() { return api; },
        range() {
          return Promise.resolve({
            data: state.rows.filter((row) => row.user_id === state.userId),
            error: null,
          });
        },
        delete() { return api; },
      };
      return api;
    };
    return {
      filters,
      auth: {
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
      from(table) {
        return query(table === 'media_entries' ? media : episodes);
      },
    };
  }

  const client = fakeClient('user-a', [
    { user_id: 'user-a', media_type: 'movie', media_id: 'trakt-movie-1', show_intent: null, movie_saved: true, movie_watched: false, rating: null },
    { user_id: 'user-b', media_type: 'show', media_id: 'trakt-show-8', show_intent: 'plan', movie_saved: null, movie_watched: null, rating: null },
  ], []);
  const pulled = await sync.pullTracking(client);
  expect('pull uses the signed-in user filter', client.filters.some((item) => item[0] === 'user_id' && item[1] === 'user-a'), true);
  expect('pull does not return another user row', pulled.media.some((row) => row.media_id === 'trakt-show-8'), false);
  let rejected = false;
  try {
    await sync.pushTracking(client, 'user-b', { media: {}, episodes: {} }, { media: {}, episodes: {} });
  } catch (error) {
    rejected = error.code === 'auth';
  }
  expect('push refuses a different user id', rejected, true);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/trackingSync.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261114153000_create_tracking_schema.sql'), 'utf8');
  expect('sync client does not use the service role', source.includes('service_role') || source.includes('sb_secret'), false);
  expect('sync client reads the authenticated user', source.includes('auth.getUser'), true);
  expect('media policy stays owner scoped', migration.includes('create policy media_entries_select_own'), true);
  expect('episode policy stays owner scoped', migration.includes('create policy episode_entries_select_own'), true);
  expect('records exist helper sees account A', sync.hasTrackingRecords(remoteA.state), true);

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  console.log(`Sync checks passed (${checks.length})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
