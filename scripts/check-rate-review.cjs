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

const migration = read('supabase/migrations/20261124230000_user_media_reviews.sql');
expect('migration creates user_media_reviews', migration.includes('create table if not exists public.user_media_reviews'));
expect('migration enforces 500 char max', migration.includes('between 1 and 500'));
expect('migration owner-only RLS policies', migration.includes('user_media_reviews_select_own') && migration.includes('auth.uid()'));
expect('migration extends list_following_activity with review fields', migration.includes('review_text') && migration.includes('review_contains_spoilers'));
expect('migration does not grant broad public select', migration.includes('revoke all on table public.user_media_reviews from public, anon'));

const sheet = read('src/components/ui/RatingSheet.js');
expect('sheet includes review input', sheet.includes('rating.review.placeholder') && sheet.includes('TextInput'));
expect('sheet includes SpoilerToggle', sheet.includes('SpoilerToggle'));
expect('sheet sticky save label', sheet.includes('rating.saveReview'));
expect('sheet remove review action', sheet.includes('rating.review.remove'));
expect('sheet keeps remove rating', sheet.includes('rating.remove'));
expect('sheet uses KeyboardAvoidingView', sheet.includes('KeyboardAvoidingView'));
expect('sheet shows artwork', sheet.includes('Artwork'));

const spoiler = read('src/components/ui/SpoilerToggle.js');
expect('spoiler is switch role', spoiler.includes('accessibilityRole="switch"'));
expect('spoiler uses eye icons', spoiler.includes('eye-off') && spoiler.includes("'eye'"));
expect('spoiler animates thumb', spoiler.includes('translateX') && spoiler.includes('Animated'));
expect('spoiler respects reduce motion', spoiler.includes('isReduceMotionEnabled'));

const feedCard = read('src/components/social/ActivityFeedCard.js');
expect('feed card renders SpoilerReviewBlock', feedCard.includes('SpoilerReviewBlock'));

const spoilerBlock = read('src/components/social/SpoilerReviewBlock.js');
expect('spoiler block uses i18n reveal copy', spoilerBlock.includes('social.activity.spoilers.tap'));
expect('spoiler block can hide again', spoilerBlock.includes('spoilers.hide'));

const layout = read('src/app/_layout.js');
expect('ReviewsProvider mounted', layout.includes('ReviewsProvider'));

const en = JSON.parse(read('src/i18n/locales/en.json'));
expect('i18n review keys', Boolean(en.rating.review?.placeholder) && Boolean(en.rating.spoiler?.title));
expect('i18n social spoiler keys', Boolean(en.social.activity?.spoilers?.tap));

expect(
  'pgtap reviews prepared',
  fs.existsSync(path.join(root, 'supabase/tests/database/user_media_reviews_security.test.sql'))
);

const rulesSource = read('src/reviews/reviewRules.js').replace(/export /g, '');
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(`${rulesSource}\nmodule.exports = { REVIEW_MAX_LENGTH, clampReviewText, trimmedReviewText, reviewPayloadFromInput, isValidReviewText };`, sandbox);
const rules = sandbox.module.exports;

expect('max length 500', rules.REVIEW_MAX_LENGTH, 500);
expect('clamp truncates', rules.clampReviewText('x'.repeat(505)).length, 500);
expect('empty review payload marks empty', rules.reviewPayloadFromInput({
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
  reviewText: '   ',
}).empty, true);
expect('spoiler cleared when empty', rules.reviewPayloadFromInput({
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
  reviewText: '',
  containsSpoilers: true,
}).containsSpoilers, false);
expect('valid movie review', rules.reviewPayloadFromInput({
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
  reviewText: 'Loved it',
  containsSpoilers: true,
}), {
  mediaType: 'movie',
  mediaId: 'trakt-movie-1',
  showMediaId: null,
  seasonNumber: null,
  episodeNumber: null,
  reviewText: 'Loved it',
  containsSpoilers: true,
  empty: false,
});
expect('episode requires season numbers', rules.reviewPayloadFromInput({
  mediaType: 'episode',
  mediaId: 'trakt-episode-1',
  showMediaId: 'trakt-show-1',
  reviewText: 'Wow',
}), null);
expect('episode review ok', Boolean(rules.reviewPayloadFromInput({
  mediaType: 'episode',
  mediaId: 'trakt-episode-1',
  showMediaId: 'trakt-show-1',
  seasonNumber: 2,
  episodeNumber: 1,
  reviewText: 'Wow',
})), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Rate & review checks passed (${checks.length})`);
