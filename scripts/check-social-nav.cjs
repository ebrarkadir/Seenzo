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

const tabsLayout = read('src/app/(tabs)/_layout.js');
const socialScreen = read('src/app/(tabs)/social.js');
const notifications = read('src/app/social/notifications.js');
const peoplePanel = read('src/components/social/PeopleDiscoveryPanel.js');
const feedCard = read('src/components/social/ActivityFeedCard.js');
const feedEmpty = read('src/components/social/ActivityFeedEmptyState.js');
const feedHeader = read('src/components/social/ActivityFeedHeader.js');
const sectionTabs = read('src/components/social/SocialSectionTabs.js');
const searchRoute = read('src/app/users/search.js');
const en = JSON.parse(read('src/i18n/locales/en.json'));

const tabOrder = ['index', 'movies', 'discover', 'social', 'profile']
  .map((name) => tabsLayout.indexOf(`name="${name}"`));
expect('five tabs registered in order', tabOrder.every((index, i, arr) => index >= 0 && (i === 0 || index > arr[i - 1])));
expect('social tab uses people icon', tabsLayout.includes('people-outline') && tabsLayout.includes('filledName="people"'));
expect('tab bar uses safe area padding', tabsLayout.includes('useSafeAreaInsets') && tabsLayout.includes('paddingBottom'));
expect('social header has search and notifications', socialScreen.includes('search') && socialScreen.includes('/social/notifications'));
expect('social header uses top safe area inset', socialScreen.includes('useSafeAreaInsets') && socialScreen.includes('insets.top'));
expect('default section following', socialScreen.includes("'following'") && socialScreen.includes('normalizeSection'));
expect('people section switch', socialScreen.includes("'people'") && socialScreen.includes('changeSection'));
expect('following loads real connections', socialScreen.includes('listFollowConnections'));
expect('following uses friends activity feed', socialScreen.includes('FriendsActivityFeed'));
expect('following shows empty state helpers', feedEmpty.includes('onPrimary'));
expect('find people button is centered', feedEmpty.includes('buttonSlot') && feedEmpty.includes("maxWidth: 280"));
expect('activity empty copy present', en.social.activityEmptyTitle === 'No activity yet');
expect('activity card component exists', feedCard.includes('ActivityFeedCard'));
expect('social screen does not hardcode feed cards', !socialScreen.includes('<ActivityFeedCard'));
expect('activity card documents v3 types', feedCard.includes('movie_watched'));
expect('feed header component exists', feedHeader.includes('ActivityFeedHeader'));
expect('underline section tabs', sectionTabs.includes('underlineSelected') && sectionTabs.includes('accessibilityRole="tab"'));
expect('people panel reuses searchPublicProfiles', peoplePanel.includes('searchPublicProfiles') && peoplePanel.includes('SOCIAL_SEARCH_DEBOUNCE_MS'));
expect('people panel has retry', peoplePanel.includes('retry') && peoplePanel.includes('common.retry'));
expect('search deep link reuses panel', searchRoute.includes('PeopleDiscoveryPanel'));
expect(
  'notifications use real unread without fake badge counts',
  notifications.includes('notificationsEmptyTitle')
    && notifications.includes('listSocialNotifications')
    && !/badgeCount|fakeNotif/i.test(notifications)
);
expect('i18n tabs.social', en.tabs.social, 'Social');
expect('i18n feed empty copy', en.social.feedEmptyTitle, 'Your circle starts here');
expect('i18n notifications empty', Boolean(en.social.notificationsEmptyBody));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Social nav checks passed (${checks.length})`);
