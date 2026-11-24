const fs = require('fs');
const path = require('path');
const vm = require('vm');

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

// --- Static wiring ---
const mediaModule = read('src/services/supabase/activityFeedMedia.js');
expect('feed media uses posterPath not poster field alone', mediaModule.includes('posterPath') && mediaModule.includes('posterFromRecord'));
expect('episode artwork uses showMediaId', mediaModule.includes('item.showMediaId') && mediaModule.includes('Never treat trakt-episode'));
expect('remote hydrate via hydrateMovie/hydrateShow', mediaModule.includes('hydrateMovie') && mediaModule.includes('hydrateShow'));
expect('hydrate remembers into catalog cache', mediaModule.includes('rememberMovie') && mediaModule.includes('rememberShow'));

const card = read('src/components/social/ActivityFeedCard.js');
expect('card uses Artwork for posters', card.includes("import Artwork from '../../services/artwork/Artwork'") && card.includes('posterPath={posterPath}'));
expect('card shows rating /10 label', card.includes('ratingLabel') && card.includes('/10'));

const item = read('src/components/social/ActivityFeedItem.js');
expect('feed item hydrates async without blocking', item.includes('hydrateActivityMedia') && item.includes('useEffect'));

const feed = read('src/components/social/FriendsActivityFeed.js');
expect('friends feed renders ActivityFeedItem', feed.includes('ActivityFeedItem') && !feed.includes('resolveActivityMedia('));

const socialActivity = read('src/services/supabase/socialActivity.js');
expect('rating publish prefers getSession', socialActivity.includes('getSession()'));
expect('rating publish validates trakt ids', socialActivity.includes('trakt-movie-') && socialActivity.includes('normalizeRatingPayload'));
expect('rating publish logs failures in dev', socialActivity.includes('rating_publish_failed'));

const tracking = read('src/tracking/TrackingContext.js');
expect('episode rating uses episodeLookup/keptEpisodes', tracking.includes('episodeLookup(before, episodeId)') && tracking.includes('keptEpisodes'));
expect('movie rating requires watched before publish', tracking.includes("movies?.[movieId]?.watched"));
expect('sync backup republishes rating changes only', tracking.includes('previousRating === nextRating') && tracking.includes("activityType: 'movie_rated'"));
expect('demo still skips immediate social publish path', tracking.includes('!stateRef.current?.demoMode'));

const fixMigration = read('supabase/migrations/20261124223000_social_activity_rating_publish_fix.sql');
expect('corrective migration hardens publish rpc', fixMigration.includes('create or replace function public.publish_social_rating_event'));
expect('corrective migration adds tracking rating triggers', fixMigration.includes('media_entries_publish_social_rating') && fixMigration.includes('episode_entries_publish_social_rating'));
expect('corrective migration ignores INSERT backfill', fixMigration.includes('Ignores INSERT') || fixMigration.includes('tg_op <> \'UPDATE\''));
expect('corrective migration never blocks tracking on social failure', fixMigration.includes('Never block personal tracking'));

// --- Pure presentation helpers (no RN) ---
const presentationSource = read('src/services/supabase/activityFeedPresentation.js')
  .replace(/export /g, '');
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(`${presentationSource}\nmodule.exports = { describeActivityAction, formatActivityRating };`, sandbox);
const { formatActivityRating, describeActivityAction } = sandbox.module.exports;

expect('formatActivityRating null', formatActivityRating(null), null);
expect('formatActivityRating integer', formatActivityRating(9), '9/10');
expect('formatActivityRating half', formatActivityRating(9.5), '9.5/10');

const t = (key) => key;
expect('describe movie rated', describeActivityAction(t, { activityType: 'movie_rated' }), 'social.activity.actions.movieRated');
expect('describe show rated', describeActivityAction(t, { activityType: 'show_rated' }), 'social.activity.actions.showRated');
expect('describe episode rated', describeActivityAction(t, { activityType: 'episode_rated' }), 'social.activity.actions.episodeRated');

// Media resolver with stubbed catalog
const mediaSource = read('src/services/supabase/activityFeedMedia.js')
  .replace(/from '\.\.\/\.\.\/data\/mediaLibrary'/g, "from '__media__'")
  .replace(/from '\.\.\/trakt\/catalog'/g, "from '__catalog__'")
  .replace(/from '\.\.\/trakt\/normalize'/g, "from '__normalize__'")
  .replace(/export /g, '');

const movies = {
  'trakt-movie-1': { id: 'trakt-movie-1', title: 'Interstellar', year: 2014, posterPath: 'walter.trakt.tv/poster1' },
};
const shows = {
  'trakt-show-2': { id: 'trakt-show-2', title: 'Breaking Bad', year: 2008, posterPath: 'walter.trakt.tv/poster2' },
};

const mediaSandbox = {
  module: { exports: {} },
  exports: {},
  Map,
  console,
  __media__: {
    resolveMovie: (id) => movies[id] || null,
    resolveShow: (id) => shows[id] || null,
    rememberMovie: (movie) => { movies[movie.id] = movie; return movie; },
    rememberShow: (show) => { shows[show.id] = show; return show; },
  },
  __catalog__: {
    hydrateMovie: async (traktId) => ({
      id: `trakt-movie-${traktId}`,
      title: 'Remote Movie',
      year: 2026,
      posterPath: 'walter.trakt.tv/remote-movie',
    }),
    hydrateShow: async (traktId) => ({
      id: `trakt-show-${traktId}`,
      title: 'Remote Show',
      year: 2011,
      posterPath: 'walter.trakt.tv/remote-show',
    }),
  },
  __normalize__: {
    parseTraktMovieKey: (id) => (/^trakt-movie-(\d+)$/.exec(id || '') || [])[1] || null,
    parseTraktShowKey: (id) => (/^trakt-show-(\d+)$/.exec(id || '') || [])[1] || null,
  },
};

// Rewrite imports for vm
const rewritten = mediaSource
  .replace(/import \{[^}]+\} from '__media__';/, 'const { resolveMovie, resolveShow, rememberMovie, rememberShow } = __media__;')
  .replace(/import \{[^}]+\} from '__catalog__';/, 'const { hydrateMovie, hydrateShow } = __catalog__;')
  .replace(/import \{[^}]+\} from '__normalize__';/, 'const { parseTraktMovieKey, parseTraktShowKey } = __normalize__;');

vm.runInNewContext(
  `${rewritten}\nmodule.exports = { resolveActivityMediaSync, hydrateActivityMedia, resetActivityMediaCache };`,
  mediaSandbox
);
const { resolveActivityMediaSync, hydrateActivityMedia, resetActivityMediaCache } = mediaSandbox.module.exports;

const movieLocal = resolveActivityMediaSync({
  activityType: 'movie_watched',
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
});
expect('local movie uses posterPath', movieLocal.posterPath, 'walter.trakt.tv/poster1');
expect('local movie title', movieLocal.title, 'Interstellar');
expect('local movie no hydrate when poster present', movieLocal.hydrateTarget, null);

const episodeLocal = resolveActivityMediaSync({
  activityType: 'episode_watched',
  mediaType: 'episode',
  mediaId: 'trakt-episode-99',
  showMediaId: 'trakt-show-2',
  seasonNumber: 2,
  episodeNumber: 1,
});
expect('episode uses parent show poster', episodeLocal.posterPath, 'walter.trakt.tv/poster2');
expect('episode title is show title', episodeLocal.title, 'Breaking Bad');
expect('episode meta has code', episodeLocal.meta.includes('S02E01'), true);
expect('episode route is show', episodeLocal.route, '/show/trakt-show-2');

const unknownMovie = resolveActivityMediaSync({
  activityType: 'movie_rated',
  mediaType: 'movie',
  mediaId: 'trakt-movie-42',
});
expect('unknown movie needs hydrate', Boolean(unknownMovie.hydrateTarget), true);
expect('unknown movie placeholder title is id', unknownMovie.title, 'trakt-movie-42');
expect('unknown movie no poster', unknownMovie.posterPath, null);

resetActivityMediaCache();
hydrateActivityMedia(unknownMovie.hydrateTarget).then((remote) => {
  expect('remote movie hydrate title', remote?.title, 'Remote Movie');
  expect('remote movie hydrate poster', remote?.posterPath, 'walter.trakt.tv/remote-movie');

  const unknownEpisode = resolveActivityMediaSync({
    activityType: 'episode_rated',
    mediaType: 'episode',
    mediaId: 'trakt-episode-7',
    showMediaId: 'trakt-show-55',
    seasonNumber: 1,
    episodeNumber: 3,
  });
  return hydrateActivityMedia(unknownEpisode.hydrateTarget).then((showRemote) => {
    expect('episode parent show hydrate poster', showRemote?.posterPath, 'walter.trakt.tv/remote-show');
    expect('episode does not hydrate as episode id', unknownEpisode.hydrateTarget?.kind, 'show');

    const failed = checks.filter((check) => !check.pass);
    if (failed.length) {
      console.error(JSON.stringify(failed, null, 2));
      process.exit(1);
    }
    console.log(`Social activity fix checks passed (${checks.length})`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
