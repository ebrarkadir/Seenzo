const fs = require('fs');
const path = require('path');

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

const migration = read('supabase/migrations/20261124210000_social_activity_feed.sql');
expect('migration adds share_activity_with_followers default false', migration.includes('share_activity_with_followers boolean not null default false'));
expect('migration creates social_activity_events', migration.includes('create table if not exists public.social_activity_events'));
expect('migration revokes authenticated DML', migration.includes('revoke all on table public.social_activity_events from public, anon, authenticated'));
expect('migration watch trigger individual only', migration.includes("new.source is distinct from 'individual'"));
expect('migration excludes bulk via source', migration.includes('season_bulk') && migration.includes('episode_catchup'));
expect('migration list_following_activity rpc', migration.includes('create or replace function public.list_following_activity'));
expect('migration requires follow created_at gate', migration.includes('a.created_at >= f.created_at'));
expect('migration live sharing check on read', migration.includes('share_activity_with_followers = true'));
expect('migration rating rpc self-only', migration.includes('publish_social_rating_event') && migration.includes('auth.uid()'));
expect('migration search_path locked', migration.includes("set search_path = ''"));

const tracking = read('src/tracking/TrackingContext.js');
expect('catchup uses episode_catchup source', tracking.includes("source: 'episode_catchup'"));
expect('ratings publish social events', tracking.includes('publishSocialRatingEvent'));
expect('demo skips social rating publish', tracking.includes('!stateRef.current?.demoMode'));

const socialScreen = read('src/app/(tabs)/social.js');
expect('following uses FriendsActivityFeed', socialScreen.includes('FriendsActivityFeed'));
expect('no mock ActivityFeedCard data in social screen', !/fakeActivity|mockActivity|ActivityFeedCard/.test(socialScreen));

const feed = read('src/components/social/FriendsActivityFeed.js');
expect('feed loads listFollowingActivity', feed.includes('listFollowingActivity'));
expect('feed handles v3 unavailable', feed.includes('isSocialV3UnavailableError'));
expect('feed has refresh and pagination', feed.includes('RefreshControl') && feed.includes('onEndReached'));

const editProfile = read('src/app/edit-profile.js');
expect('edit profile has share activity toggle', editProfile.includes('shareActivityWithFollowers') && editProfile.includes('shareActivityHint'));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n share activity copy', Boolean(en.profile.shareActivityHint));
expect('i18n activity actions', Boolean(en.social.activity?.actions?.movieWatched));

expect(
  'pgtap social v3 prepared',
  fs.existsSync(path.join(root, 'supabase/tests/database/social_v3_activity_feed_security.test.sql'))
);

expect(
  'corrective rating publish migration present',
  fs.existsSync(path.join(root, 'supabase/migrations/20261124223000_social_activity_rating_publish_fix.sql'))
);

const feedMedia = read('src/services/supabase/activityFeedMedia.js');
expect('activity media resolves posterPath', feedMedia.includes('posterPath'));
expect('activity media hydrates remote trakt', feedMedia.includes('hydrateMovie'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Social activity checks passed (${checks.length})`);
