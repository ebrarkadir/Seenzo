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

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const rules = loadModules(
  ['src/services/supabase/profileRules.js', 'src/services/supabase/socialRules.js'],
  [
    'canEnableDiscovery',
    'resolveRelationshipAction',
    'normalizeRelationship',
    'normalizeNotificationRow',
    'formatRelativeTime',
    'RELATIONSHIP',
  ].join(', ')
);

expect('discovery requires username', rules.canEnableDiscovery({ username: 'ab', allowProfileDiscovery: true }), false);
expect('discovery accepts username', rules.canEnableDiscovery({ username: 'seenzo_fan', allowProfileDiscovery: true }), true);
expect(
  'follow back when follows you',
  rules.resolveRelationshipAction(rules.normalizeRelationship({
    is_following: false,
    follows_you: true,
  })),
  rules.RELATIONSHIP.FOLLOW_BACK
);
expect(
  'requested when outgoing pending',
  rules.resolveRelationshipAction(rules.normalizeRelationship({
    is_following: false,
    outgoing_request_id: 'req-1',
  })),
  rules.RELATIONSHIP.REQUESTED
);
expect(
  'notification unread when read_at null',
  rules.normalizeNotificationRow({
    id: 'n1',
    type: 'new_follower',
    actor_user_id: 'u1',
    actor_username: 'ada',
    read_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }).unread,
  true
);
expect('relative time minutes', Boolean(rules.formatRelativeTime(new Date(Date.now() - 120000).toISOString())));

const migration = read('supabase/migrations/20261124150000_social_follow_requests_notifications.sql');
expect('migration adds allow_profile_discovery', migration.includes('allow_profile_discovery boolean not null default false'));
expect('migration creates follow requests', migration.includes('create table if not exists public.profile_follow_requests'));
expect('migration pending unique', migration.includes('profile_follow_requests_pending_unique'));
expect('migration creates notifications', migration.includes('create table if not exists public.social_notifications'));
expect('migration notifications no client insert', migration.includes('revoke insert, update, delete on table public.social_notifications from authenticated'));
expect('migration request_or_follow rpc', migration.includes('create or replace function public.request_or_follow'));
expect('migration concurrent request upsert', migration.includes('on conflict (requester_id, target_id) where status = \'pending\''));
expect('migration follow request cooldown', migration.includes('follow_request_cooldown') && migration.includes('follow_request_limit'));
expect('migration unfollow clears follower notification', migration.includes('profile_follows_cleanup_follower_notification'));
expect(
  'migration discoverable avatar is exact active path only',
  migration.includes('profiles.avatar_path = name')
    && migration.includes('profiles.allow_profile_discovery = true')
    && migration.includes('profiles.is_public = false')
    && !/foldername\(name\)\)\[2\] = 'avatar'/.test(migration)
);
expect('migration search escapes like with bang', migration.includes("like v_pattern escape '!'") && migration.includes("'_', '!_'"));
expect('migration relationship hides undiscovable', migration.includes('social_can_view_relationship') && migration.includes("raise exception 'profile_not_found'"));
expect('migration helpers not client-executable', migration.includes('revoke all on function public.social_is_discoverable(uuid) from public, anon, authenticated'));
expect('migration counts align with visible list', migration.includes('Non-owners only count connections'));
expect('migration accept ownership check', migration.includes('not_request_recipient'));
expect('migration list connections rpc', migration.includes('list_follow_connections'));
expect('migration search discoverable rpc', migration.includes('search_discoverable_profiles'));
expect('migration safe search_path', migration.includes("set search_path = ''"));
expect(
  'pgtap covers concurrent/refollow/hidden',
  read('supabase/tests/database/social_v2_follow_requests_security.test.sql').includes('duplicate request_or_follow')
    && read('supabase/tests/database/social_v2_follow_requests_security.test.sql').includes('genuine re-follow')
    && read('supabase/tests/database/social_v2_follow_requests_security.test.sql').includes('hidden private profiles are opaque')
);

const social = read('src/services/supabase/social.js');
const graph = read('src/services/supabase/socialGraph.js');
expect('follow uses request_or_follow with fallback', social.includes('requestOrFollow') && social.includes('social_v2_unavailable'));
expect('search prefers discoverable rpc', social.includes('searchDiscoverableProfiles'));
expect('search excludes current user client-side', social.includes('item.userId !== viewerId') || social.includes("item.userId !== viewerId"));
expect('search v1 fallback excludes self', social.includes(".neq('user_id', viewerId)"));
expect('discoverable rpc excludes caller', migration.includes('p.user_id <> v_caller'));
expect('graph search filters self rows', graph.includes('row?.user_id !== viewerId'));
expect('graph never uses service role', !/service_role|SERVICE_ROLE/i.test(graph));
expect('demo blocked in people panel', read('src/components/social/PeopleDiscoveryPanel.js').includes('demoBlocked'));
expect('connections screen exists', read('src/app/users/connections.js').includes('listFollowConnections'));
const notificationsScreen = read('src/app/social/notifications.js');
expect('notifications screen loads rpc', notificationsScreen.includes('listSocialNotifications'));
expect(
  'notifications follow-back survives focus refetch',
  notificationsScreen.includes('followBackDoneByActorRef')
    && notificationsScreen.includes('applyFollowBackState')
);
expect(
  'notifications follow-back marks actor across rows',
  notificationsScreen.includes('followBackDoneByActorRef.current.add(actorId)')
);
expect(
  'notification row uses followBackCompleted',
  read('src/components/social/NotificationRow.js').includes('followBackCompleted')
);
expect('social badge uses unread count', read('src/app/(tabs)/social.js').includes('getUnreadSocialNotificationCount'));
expect('profile counts tappable', read('src/app/(tabs)/profile.js').includes('FollowCountsRow'));
expect('public profile uses relationship button', read('src/components/social/PublicProfileView.js').includes('RelationshipButton'));
expect('edit profile discovery controls', read('src/app/edit-profile.js').includes('allowProfileDiscovery'));
expect('activity feed plan present', fs.existsSync(path.join(root, 'docs/SOCIAL_ACTIVITY_FEED_PLAN.md')));
expect('pgtap social v2 prepared', fs.existsSync(path.join(root, 'supabase/tests/database/social_v2_follow_requests_security.test.sql')));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Social V2 checks passed (${checks.length})`);
