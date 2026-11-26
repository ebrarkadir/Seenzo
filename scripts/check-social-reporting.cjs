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

const migration = read('supabase/migrations/20261126220000_social_reporting_expand.sql');
expect('migration widens target_type', migration.includes("'profile'"));
expect('migration keeps review_comment', migration.includes("'review_comment'"));
expect('migration keeps social_activity', migration.includes("'social_activity'"));
expect('migration same rpc signature', migration.includes('report_social_content(\n  p_target_type text'));
expect('migration already_reported', migration.includes("raise exception 'already_reported'"));
expect('migration cannot_report_self', migration.includes("raise exception 'cannot_report_self'"));
expect('migration rate limit kept', migration.includes("raise exception 'report_rate_limited'"));
expect('migration profile uses view helper', migration.includes('social_can_view_relationship'));
expect('migration profile block gate', /p_target_type = 'profile'[\s\S]*social_is_blocked/i.test(migration));
expect('migration activity access gate', migration.includes('social_can_access_review_activity'));
expect('migration no auto delete content', /delete from public\.(social_review_comments|social_activity_events|user_media_reviews)/i.test(migration) === false);
expect('migration no drop cascade', /drop\s+function[\s\S]*cascade/i.test(migration) === false);

const interactions = loadModules(
  [
    'src/services/supabase/profileRules.js',
    'src/services/supabase/socialRules.js',
    'src/services/supabase/socialInteractions.js',
  ],
  'REPORT_TARGET, REPORT_REASON_KEYS'
);
expect('report targets', interactions.REPORT_TARGET, {
  PROFILE: 'profile',
  SOCIAL_ACTIVITY: 'social_activity',
  REVIEW_COMMENT: 'review_comment',
});
expect('report reasons include spam', interactions.REPORT_REASON_KEYS.includes('spam'));

const sheet = read('src/components/social/ReportSheet.js');
expect('report sheet uses reasons', sheet.includes('REPORT_REASON_KEYS'));
expect('report sheet submit disabled without reason', sheet.includes('disabled={!reason || submitting}'));

const profileUi = read('src/components/social/PublicProfileView.js');
expect('profile has report action', profileUi.includes('onReportUser') && profileUi.includes('social.report.action'));

const username = read('src/app/user/[username].js');
expect('username wires ReportSheet', username.includes('ReportSheet') && username.includes('REPORT_TARGET.PROFILE'));
expect('username hides report for self', username.includes('onReportUser={payload.isSelf ? undefined : onReportUser}'));

const feedItem = read('src/components/social/ActivityFeedItem.js');
expect('feed item can report others', feedItem.includes('canReport') && feedItem.includes('REPORT_TARGET.SOCIAL_ACTIVITY'));
expect('feed item skips own actor', feedItem.includes('item.actor.userId !== viewerId'));

const bar = read('src/components/social/ReviewInteractionBar.js');
expect('interaction bar report control', bar.includes('canReport') && bar.includes('onReport'));

const discussion = read('src/app/social/discussion.js');
expect('discussion uses ReportSheet', discussion.includes('ReportSheet') && discussion.includes('REPORT_TARGET.REVIEW_COMMENT'));

const commentRow = read('src/components/social/ReviewCommentRow.js');
expect('comment row keeps report action', commentRow.includes('social.discussion.report'));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n report action', Boolean(en.social.report?.action));
expect('i18n already_reported', Boolean(en.social.errors?.already_reported));
expect('i18n cannot_report_self', Boolean(en.social.errors?.cannot_report_self));
expect('i18n report_rate_limited', Boolean(en.social.errors?.report_rate_limited));

const pgtap = read('supabase/tests/database/social_reporting_expand.test.sql');
expect('pgTAP profile report', pgtap.includes('A can report B profile'));
expect('pgTAP self report', pgtap.includes('cannot_report_self'));
expect('pgTAP already reported', pgtap.includes('already_reported'));
expect('pgTAP blocked opaque', pgtap.includes('blocked profile report is opaque'));
expect('pgTAP rate limit', pgtap.includes('report_rate_limited'));
expect('pgTAP direct insert denied', pgtap.includes('direct insert into social_content_reports is denied'));

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
