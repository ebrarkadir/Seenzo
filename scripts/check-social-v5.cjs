const fs = require('fs');
const path = require('path');

function loadModules(relativePaths, returned) {
  const code = relativePaths.map((relativePath) => {
    const file = path.join(__dirname, '..', relativePath);
    return fs.readFileSync(file, 'utf8')
      .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*/g, '')
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

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261126200000_social_v5_profile_reviews_friends_ratings_feed.sql');
expect('v5 migration filtered feed rpc', migration.includes('list_following_activity_filtered'));
expect('v5 does not drop legacy feed with cascade', /drop function[\s\S]*list_following_activity[\s\S]*cascade/i.test(migration) === false);
expect('v5 filter before limit', migration.includes("v_filter = 'reviews'"));
expect('v5 profile reviews rpc', migration.includes('list_profile_reviews'));
expect('v5 friends ratings rpc', migration.includes('get_friends_media_ratings'));
expect('v5 no public profile alone for reviews', migration.includes('Public discoverability alone is never enough'));
expect('v5 follow-since on friends ratings', migration.includes('a.created_at >= f.created_at'));
expect('v5 zero average null', migration.includes("'average', null"));

const activity = loadModules(
  ['src/services/supabase/profileRules.js', 'src/services/supabase/socialRules.js', 'src/services/supabase/socialActivity.js'],
  'SOCIAL_FEED_FILTERS, normalizeActivityEventRow'
);
expect('feed filters exported', activity.SOCIAL_FEED_FILTERS, ['all', 'watched', 'ratings', 'reviews']);

const v5 = loadModules(
  ['src/services/supabase/profileRules.js', 'src/services/supabase/socialRules.js', 'src/services/supabase/socialV5.js'],
  [
    'normalizeProfileReviewRow',
    'normalizeFriendsRatingItem',
    'PROFILE_REVIEW_FILTERS',
    'FEED_ACTIVITY_FILTERS',
  ].join(', ')
);

expect('profile review filters', v5.PROFILE_REVIEW_FILTERS, ['all', 'movies', 'shows']);
const ownPrivate = v5.normalizeProfileReviewRow({
  id: 'r1',
  media_type: 'movie',
  media_id: 'trakt-movie-1',
  review_text: 'Secret',
  is_published: false,
  rating: 8,
});
expect('owner private flag', ownPrivate.isPrivate, true);
expect('owner not published', ownPrivate.isPublished, false);

const friend = v5.normalizeFriendsRatingItem({
  activity_id: 'a1',
  rating: 9,
  actor_username: 'maya',
  actor_user_id: 'u1',
  review_text: 'Loved it',
  has_review: true,
});
expect('friends rating username', friend.actor.username, 'maya');
expect('friends rating value', friend.rating, 9);

const feed = read('src/components/social/FriendsActivityFeed.js');
expect('feed uses filter row', feed.includes('ActivityFeedFilterRow'));
expect('feed resets cursor on filter', feed.includes('onChangeFilter') && feed.includes('cursorRef.current = { createdAt: null'));
expect('feed passes filter to list', feed.includes('nextFilter'));

const profileSection = read('src/components/social/ProfileReviewsSection.js');
expect('profile section privacy badge owner', profileSection.includes('showPrivacyBadge={isOwner}'));
expect('profile section discussion nav', profileSection.includes('/social/discussion'));

const friendsUi = read('src/components/social/FriendsRatingsSection.js');
expect('friends empty copy', friendsUi.includes('social.friendsRatings.empty'));
expect('friends no fake zero average render', friendsUi.includes('ratingCount || 0) === 0'));
expect('friends demo/session gated by enabled', friendsUi.includes('if (!enabled)'));

const ownProfile = read('src/app/(tabs)/profile.js');
expect('own profile mounts reviews', ownProfile.includes('ProfileReviewsSection'));
expect('own profile skips demo', ownProfile.includes('!demoMode'));

const publicProfile = read('src/app/user/[username].js');
expect('public profile mounts reviews', publicProfile.includes('ProfileReviewsSection'));

const movie = read('src/app/movie/[id].js');
const show = read('src/app/show/[id].js');
expect('movie friends ratings', movie.includes('FriendsRatingsSection') && movie.includes('mediaType="movie"'));
expect('show friends ratings', show.includes('FriendsRatingsSection') && show.includes('mediaType="show"'));
expect('movie preserves trakt rating', movie.includes('communityRating'));
expect('movie preserves rate chip', movie.includes('RateChip'));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n feed filters', Boolean(en.social.feedFilters?.reviews));
expect('i18n profile reviews', Boolean(en.social.profileReviews?.title));
expect('i18n friends ratings', Boolean(en.social.friendsRatings?.title));

const pgtap = read('supabase/tests/database/social_v5_profile_reviews_friends_ratings.test.sql');
expect('pgTAP present', pgtap.includes('list_profile_reviews'));
expect('pgTAP sharing off', pgtap.includes('sharing off'));

const failed = checks.filter((item) => !item.pass);
for (const item of checks) {
  const mark = item.pass ? 'PASS' : 'FAIL';
  console.log(`${mark} ${item.name}`);
  if (!item.pass) {
    console.log(`  expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`);
  }
}
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} checks passed`);
