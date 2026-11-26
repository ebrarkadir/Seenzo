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

const migration = read('supabase/migrations/20261126210000_user_blocks.sql');
expect('migration creates user_blocks', migration.includes('create table if not exists public.user_blocks'));
expect('migration composite pk', migration.includes('primary key (blocker_id, blocked_id)'));
expect('migration self-block check', migration.includes('user_blocks_no_self'));
expect('migration no client table grants to authenticated insert', /grant\s+insert\s+on\s+table\s+public\.user_blocks\s+to\s+authenticated/i.test(migration) === false);
expect('migration social_is_blocked helper', migration.includes('social_is_blocked'));
expect('migration auth.uid gate on helper', migration.includes('p_user_a = auth.uid()'));
expect('migration service_role gate on helper', migration.includes("coalesce(auth.role(), '') = 'service_role'"));
expect(
  'migration rejects bare null-uid privilege bypass',
  /auth\.uid\(\)\s+is\s+null\b/.test(migration) === false
);
expect(
  'migration accept blocked cancels without raise',
  /social_is_blocked\(v_caller, v_requester\)[\s\S]*return false;[\s\S]*insert into public\.profile_follows/i.test(migration)
  && /social_is_blocked\(v_caller, v_requester\)[\s\S]*raise exception 'blocked'/i.test(migration) === false
);
expect('migration block_user rpc', migration.includes('create or replace function public.block_user'));
expect('migration unblock_user rpc', migration.includes('create or replace function public.unblock_user'));
expect('migration list_blocked_users rpc', migration.includes('create or replace function public.list_blocked_users'));
expect('migration clears follows', migration.includes('delete from public.profile_follows'));
expect('migration clears pending requests', migration.includes("status = 'cancelled'"));
expect('migration clears mutual notifications', migration.includes('delete from public.social_notifications'));
expect('migration gates request_or_follow', /request_or_follow[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates search', /search_discoverable_profiles[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates profile card', /get_discoverable_profile_card[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates feed', /list_following_activity[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates filtered feed', /list_following_activity_filtered[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates profile reviews', /list_profile_reviews[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates friends ratings', /get_friends_media_ratings[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates review access helper', /social_can_access_review_activity[\s\S]*social_is_blocked/i.test(migration));
expect('migration gates notifications', /list_social_notifications[\s\S]*social_is_blocked/i.test(migration));
expect('migration no drop cascade', /drop\s+function[\s\S]*cascade/i.test(migration) === false);
expect('migration search_path empty', migration.includes("set search_path = ''"));

const blocks = loadModules(
  [
    'src/services/supabase/profileRules.js',
    'src/services/supabase/socialRules.js',
    'src/services/supabase/socialBlocks.js',
  ],
  'normalizeBlockedUserRow, BLOCKED_USERS_PAGE_SIZE, isSocialBlocksUnavailableError'
);

const normalized = blocks.normalizeBlockedUserRow({
  user_id: 'u1',
  username: 'maya',
  display_name: 'Maya',
  avatar_path: null,
  is_public: true,
  allow_profile_discovery: false,
  blocked_at: '2026-11-26T00:00:00Z',
});
expect('normalize blocked user id', normalized.userId, 'u1');
expect('normalize blocked username', normalized.username, 'maya');
expect('normalize blocked at', normalized.blockedAt, '2026-11-26T00:00:00Z');
expect('page size', blocks.BLOCKED_USERS_PAGE_SIZE, 30);
expect(
  'unavailable detector',
  blocks.isSocialBlocksUnavailableError({ message: 'Could not find the function list_blocked_users' }),
  true
);

const profileUi = read('src/components/social/PublicProfileView.js');
expect('profile view block action', profileUi.includes('onBlockUser') && profileUi.includes('social.block.blockAction'));

const usernameScreen = read('src/app/user/[username].js');
expect('username screen imports blockUser', usernameScreen.includes("from '../../services/supabase/socialBlocks'"));
expect('username screen confirmation', usernameScreen.includes('social.block.confirmTitle'));
expect('username screen demo guard', usernameScreen.includes('social.block.demoBlockedBody'));

const blockedScreen = read('src/app/users/blocked.js');
expect('blocked list uses listBlockedUsers', blockedScreen.includes('listBlockedUsers'));
expect('blocked list unblock', blockedScreen.includes('unblockUser'));
expect('blocked list empty state', blockedScreen.includes('social.block.emptyTitle'));

const editProfile = read('src/app/edit-profile.js');
expect('edit profile links blocked list', editProfile.includes('/users/blocked'));

const layout = read('src/app/_layout.js');
expect('layout registers blocked route', layout.includes('users/blocked'));

const graph = read('src/services/supabase/socialGraph.js');
expect('graph maps blocked errors', graph.includes("markCoded('blocked'"));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n block action', Boolean(en.social.block?.blockAction));
expect('i18n blocked list', Boolean(en.social.block?.listTitle));
expect('i18n blocked error', Boolean(en.social.errors?.blocked));
expect('i18n cannot_block_self', Boolean(en.social.errors?.cannot_block_self));

const pgtap = read('supabase/tests/database/social_user_blocks_security.test.sql');
expect('pgTAP self-block', pgtap.includes('cannot_block_self'));
expect('pgTAP clears follows', pgtap.includes('clears bidirectional follows'));
expect('pgTAP pending requests', pgtap.includes('pending'));
expect('pgTAP no auto-refollow', pgtap.includes('does not restore follows'));
expect('pgTAP foreign unblock', pgtap.includes('cannot unblock on behalf'));
expect('pgTAP direct table denied', pgtap.includes('direct insert into user_blocks is denied'));
expect('pgTAP search filter', pgtap.includes('search excludes blocked'));
expect('pgTAP notifications filter', pgtap.includes('notifications exclude blocked actors'));
expect('pgTAP accept cancels when blocked', pgtap.includes('accept cancels blocked request without rollback'));
expect('graph maps false accept to blocked', read('src/services/supabase/socialGraph.js').includes("markCoded('blocked')"));

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
console.log(`\n${checks.length} passed`);
