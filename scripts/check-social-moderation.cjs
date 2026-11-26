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

const migration = read('supabase/migrations/20261126230000_social_moderation_basic.sql');
expect('migration adds report status', migration.includes("status text not null default 'open'"));
expect('migration adds moderation_actions', migration.includes('create table if not exists public.moderation_actions'));
expect('migration soft-hide activity', migration.includes('moderation_hidden_at'));
expect('migration hide activity rpc', migration.includes('moderate_hide_social_activity'));
expect('migration unhide activity rpc', migration.includes('moderate_unhide_social_activity'));
expect('migration hide comment rpc', migration.includes('moderate_hide_review_comment'));
expect('migration review report rpc', migration.includes('moderate_review_report'));
expect('migration list reports rpc', migration.includes('list_moderation_reports'));
expect('migration service_role gate', migration.includes('moderation_require_service_role'));
expect('migration no authenticated execute on hide', /grant execute on function public\.moderate_hide_social_activity[\s\S]*to authenticated/i.test(migration) === false);
expect('migration gates can_access', /social_can_access_review_activity[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates feed', /list_following_activity[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates filtered feed', /list_following_activity_filtered[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates profile reviews join', /list_profile_reviews[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates friends ratings', /get_friends_media_ratings[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates comments list', /list_review_comments[\s\S]*moderation_hidden_at is null/i.test(migration));
expect('migration gates notifications', migration.includes('moderation_notification_target_hidden'));
expect('migration no drop cascade', /drop\s+function[\s\S]*cascade/i.test(migration) === false);
expect('migration search_path empty', migration.includes("set search_path = ''"));

const ops = read('docs/MODERATION_OPS.md');
expect('ops doc exists', ops.includes('moderate_hide_social_activity'));
expect('ops doc forbids service key in mobile', ops.includes('never') && ops.toLowerCase().includes('service_role'));

const pgtap = read('supabase/tests/database/social_moderation_basic.test.sql');
expect('pgTAP denies authenticated hide', pgtap.includes('authenticated cannot execute moderate_hide'));
expect('pgTAP feed hidden', pgtap.includes('hidden activity absent from feed'));
expect('pgTAP deep link', pgtap.includes('notification deep link cannot open hidden activity'));
expect('pgTAP audit', pgtap.includes('hide writes audit row'));
expect('pgTAP unhide restore', pgtap.includes('unhide restores discussion access'));
expect('pgTAP report triage', pgtap.includes('report status transitions to actioned'));

const discussion = read('src/app/social/discussion.js');
expect('discussion keeps gone state for unavailable', discussion.includes('social.discussion.goneTitle'));

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
