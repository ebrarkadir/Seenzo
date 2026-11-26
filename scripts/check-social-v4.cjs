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

const migration = read('supabase/migrations/20261126180000_social_review_interactions.sql');
expect('migration creates likes table', migration.includes('create table if not exists public.social_review_likes'));
expect('migration unique like pk', migration.includes('primary key (user_id, activity_id)'));
expect('migration creates comments', migration.includes('create table if not exists public.social_review_comments'));
expect('migration comment length 300', migration.includes('between 1 and 300'));
expect('migration reply depth guard', migration.includes('reply_depth_exceeded'));
expect('migration parent same activity', migration.includes('invalid_parent'));
expect('migration like rpc', migration.includes('like_review_activity'));
expect('migration unlike deletes notif', migration.includes("type = 'review_liked'"));
expect('migration no self like', migration.includes('cannot_like_own'));
expect('migration access helper', migration.includes('social_can_access_review_activity'));
expect('migration requires follow share', migration.includes('share_activity_with_followers = true'));
expect('migration notification types', migration.includes("'review_liked'") && migration.includes("'comment_replied'"));
expect('migration no authenticated table grants', /grant select on table public\.social_review_likes to authenticated/i.test(migration) === false);
expect('migration list comments rpc', migration.includes('list_review_comments'));
expect('migration create comment rpc', migration.includes('create_review_comment'));
expect('migration delete comment rpc', migration.includes('delete_review_comment'));
expect('migration rate limit', migration.includes('comment_rate_limited'));
expect('migration report table', migration.includes('social_content_reports'));
expect('migration resolve target', migration.includes('resolve_review_discussion_target'));

const activity = loadModules(
  ['src/services/supabase/profileRules.js', 'src/services/supabase/socialRules.js', 'src/services/supabase/socialActivity.js'],
  'normalizeActivityEventRow'
);

const preV4 = activity.normalizeActivityEventRow({
  id: 'a1',
  activity_type: 'movie_rated',
  media_id: 'trakt-movie-1',
  review_text: 'Great',
  actor_user_id: 'u1',
  actor_username: 'maya',
});
expect('pre-V4 feed hides interactions', preV4.interactionsEnabled, false);

const v4 = activity.normalizeActivityEventRow({
  id: 'a2',
  activity_type: 'movie_rated',
  media_id: 'trakt-movie-2',
  review_text: 'Great',
  like_count: 2,
  comment_count: 1,
  liked_by_viewer: true,
  interactions_enabled: true,
  actor_user_id: 'u2',
  actor_username: 'alex',
});
expect('V4 feed enables interactions', v4.interactionsEnabled, true);
expect('V4 like count preserved', v4.likeCount, 2);
expect('V4 liked flag', v4.likedByViewer, true);

const watched = activity.normalizeActivityEventRow({
  id: 'a3',
  activity_type: 'movie_watched',
  media_id: 'trakt-movie-3',
  like_count: 9,
  interactions_enabled: true,
  actor_user_id: 'u3',
  actor_username: 'sam',
});
expect('watched events never get review text interactions from normalize review', watched.reviewText, null);

const interactions = loadModules(
  [
    'src/services/supabase/profileRules.js',
    'src/services/supabase/socialRules.js',
    'src/services/supabase/socialInteractions.js',
  ],
  [
    'canSubmitComment',
    'clampCommentText',
    'normalizeReviewCommentRow',
    'isInteractionNotificationType',
    'SOCIAL_COMMENT_MAX_LENGTH',
  ].join(', ')
);

expect('comment max 300', interactions.SOCIAL_COMMENT_MAX_LENGTH, 300);
expect('empty comment rejected', interactions.canSubmitComment('   '), false);
expect('valid comment accepted', interactions.canSubmitComment('Nice take'), true);
expect('clamp trims length', interactions.clampCommentText('x'.repeat(400)).length, 300);
expect(
  'comment spoiler normalize',
  interactions.normalizeReviewCommentRow({
    id: 'c1',
    comment_text: 'Secret',
    contains_spoilers: true,
    author_id: 'u1',
    author_username: 'maya',
    can_delete: true,
  }).containsSpoilers,
  true
);
expect('like notif type', interactions.isInteractionNotificationType('review_liked'), true);
expect('follow notif not interaction', interactions.isInteractionNotificationType('new_follower'), false);

const likeBtn = read('src/components/social/ReviewLikeButton.js');
expect('like button outlined/filled', likeBtn.includes('heart-outline') && likeBtn.includes("'heart'"));
expect('like respects reduce motion', likeBtn.includes('reduceMotion'));

const bar = read('src/components/social/ReviewInteractionBar.js');
expect('optimistic like rollback', bar.includes('previousLiked') && bar.includes('catch'));
expect('double-tap lock', bar.includes('inFlight'));
expect('demo guard', bar.includes('demoMode'));

const card = read('src/components/social/ActivityFeedCard.js');
expect('card wires interaction bar', card.includes('ReviewInteractionBar'));

const discussion = read('src/app/social/discussion.js');
expect('discussion screen exists', discussion.includes('getReviewInteractionSummary'));
expect('discussion composer limit', discussion.includes('SOCIAL_COMMENT_MAX_LENGTH'));
expect('discussion reply one level', discussion.includes('replyTo'));
expect('discussion spoiler toggle', discussion.includes('CommentSpoilerToggle'));
expect('discussion account key remount', discussion.includes('session.user.id'));
expect(
  'discussion delete refreshes summary',
  discussion.includes('deleteReviewComment')
    && /await deleteReviewComment[\s\S]*getReviewInteractionSummary/i.test(discussion)
);
expect(
  'discussion delete removes parent replies',
  discussion.includes('row.parentCommentId !== item.id')
);
expect(
  'discussion delete clears reply draft target',
  discussion.includes('current.parentCommentId === item.id')
);
expect(
  'discussion delete ignores failure for list',
  /await deleteReviewComment[\s\S]*catch \(requestError\)/i.test(discussion)
    && discussion.includes("setActionBusy(false)")
);

const commentsUi = read('src/components/social/CommentSpoilerBlock.js');
expect('comment spoiler copy', commentsUi.includes('This comment contains spoilers') === false);
expect('comment spoiler uses i18n keys', commentsUi.includes('social.discussion.spoilers'));

const notifications = read('src/app/social/notifications.js');
expect('notif opens discussion', notifications.includes('resolveReviewDiscussionTarget'));
expect('notif interaction types', notifications.includes('isInteractionNotificationType'));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n review_liked', Boolean(en.social.notifications.types.review_liked));
expect('i18n review_commented', Boolean(en.social.notifications.types.review_commented));
expect('i18n comment_replied', Boolean(en.social.notifications.types.comment_replied));
expect('i18n discussion placeholder', en.social.discussion.placeholder, 'Add a comment...');

const layout = read('src/app/_layout.js');
expect('layout registers discussion route', layout.includes('social/discussion'));

const pgtap = read('supabase/tests/database/social_review_interactions.test.sql');
expect('pgTAP file present', pgtap.includes('social_can_access_review_activity'));

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
