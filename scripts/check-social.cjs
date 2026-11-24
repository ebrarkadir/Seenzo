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

const rules = loadModules(
  [
    'src/services/supabase/profileRules.js',
    'src/services/supabase/socialRules.js',
  ],
  [
    'emptyProfile',
    'normalizeProfileRow',
    'canPublishProfile',
    'buildUsernameSearchPattern',
    'normalizePublicStats',
    'normalizeFollowCounts',
    'normalizeDiscoveryProfile',
    'SOCIAL_SEARCH_PAGE_SIZE',
    'SOCIAL_SEARCH_DEBOUNCE_MS',
  ].join(', ')
);

expect('profiles default private', rules.emptyProfile().isPublic, false);
expect('normalize defaults isPublic false', rules.normalizeProfileRow({ user_id: 'u1' }).isPublic, false);
expect('normalize reads is_public', rules.normalizeProfileRow({ user_id: 'u1', is_public: true }).isPublic, true);
expect('private always publishable', rules.canPublishProfile({ username: '', isPublic: false }), true);
expect('public requires username', rules.canPublishProfile({ username: 'ab', isPublic: true }), false);
expect('public accepts valid username', rules.canPublishProfile({ username: 'seenzo_fan', isPublic: true }), true);
expect('search pattern strips wildcards', rules.buildUsernameSearchPattern('Ada_%One'), '%adaone%');
expect('empty search returns null pattern', rules.buildUsernameSearchPattern('  '), null);
expect('stats normalize snake', rules.normalizePublicStats({ movies_watched: 3, episodes_watched: 12, shows_tracked: 2 }), {
  moviesWatched: 3,
  episodesWatched: 12,
  showsTracked: 2,
});
expect('follow counts normalize', rules.normalizeFollowCounts({ followers: 4, following: 1 }), {
  followers: 4,
  following: 1,
});
expect('discovery profile omits email fields', !Object.prototype.hasOwnProperty.call(
  rules.normalizeDiscoveryProfile({
    user_id: 'u1',
    username: 'ada',
    display_name: 'Ada',
    is_public: true,
    email: 'secret@example.com',
  }),
  'email'
));
expect('page size constant', rules.SOCIAL_SEARCH_PAGE_SIZE, 20);
expect('debounce constant', rules.SOCIAL_SEARCH_DEBOUNCE_MS, 350);

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261123180000_social_profiles_and_follows.sql'),
  'utf8'
);
expect('migration adds is_public default false', migration.includes('is_public boolean not null default false'));
expect('migration requires username for public', migration.includes('profiles_public_requires_username'));
expect('migration creates profile_follows', migration.includes('create table if not exists public.profile_follows'));
expect('migration blocks self follow', migration.includes('profile_follows_no_self'));
expect('migration public profile select policy', migration.includes('profiles_select_public'));
expect('migration public favorites select policy', migration.includes('profile_favorites_select_public'));
expect('migration public media select policy', migration.includes('profile_media_select_public_profiles'));
expect('migration follow select own only', migration.includes('profile_follows_select_own')
  && !migration.includes('profile_follows_select_own_or_public\n')
  && migration.includes('using (follower_id = (select auth.uid()))'));
expect('migration follow insert requires public target', migration.includes('profile_follows_insert_own') && migration.includes('is_public = true'));
expect('migration follow delete own only', migration.includes('profile_follows_delete_own'));
expect('migration public stats rpc', migration.includes('get_public_profile_stats'));
expect('migration follow counts rpc', migration.includes('get_public_follow_counts'));
expect('migration stats gate on public', migration.includes("raise exception 'profile_not_public'"));
expect('migration never grants anon follows', migration.includes('revoke all on table public.profile_follows from public, anon'));

const socialClient = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/social.js'), 'utf8');
expect('search filters is_public true', socialClient.includes(".eq('is_public', true)"));
expect('search uses username ilike', socialClient.includes(".ilike('username', pattern)"));
expect('public columns exclude email', !/email/i.test(socialClient.match(/PROFILE_PUBLIC_COLUMNS = '([^']+)'/)?.[1] || 'email'));
expect('follow uses auth viewer id', socialClient.includes('follower_id: viewerId'));
expect('follow rejects self client-side', socialClient.includes('viewerId === targetUserId'));
expect('follow upsert ignores duplicates', socialClient.includes('ignoreDuplicates: true'));
expect('unfollow deletes own edge', socialClient.includes(".delete()") && socialClient.includes(".eq('follower_id', viewerId)"));
expect('stats via security definer rpc', socialClient.includes("rpc('get_public_profile_stats'"));
expect('counts via security definer rpc', socialClient.includes("rpc('get_public_follow_counts'"));
expect('no service role in social client', !/service_role|SERVICE_ROLE/i.test(socialClient));

const searchScreen = fs.readFileSync(path.join(__dirname, '..', 'src/app/users/search.js'), 'utf8');
const peoplePanel = fs.readFileSync(path.join(__dirname, '..', 'src/components/social/PeopleDiscoveryPanel.js'), 'utf8');
const publicScreen = fs.readFileSync(path.join(__dirname, '..', 'src/app/user/[username].js'), 'utf8');
const publicView = fs.readFileSync(path.join(__dirname, '..', 'src/components/social/PublicProfileView.js'), 'utf8');
const editScreen = fs.readFileSync(path.join(__dirname, '..', 'src/app/edit-profile.js'), 'utf8');
const profileTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/profile.js'), 'utf8');
const layout = fs.readFileSync(path.join(__dirname, '..', 'src/app/_layout.js'), 'utf8');
const en = fs.readFileSync(path.join(__dirname, '..', 'src/i18n/locales/en.json'), 'utf8');

expect('search deep link hosts people panel', searchScreen.includes('PeopleDiscoveryPanel'));
expect('people panel debounces', peoplePanel.includes('SOCIAL_SEARCH_DEBOUNCE_MS'));
expect('people panel paginates', peoplePanel.includes('onEndReached') && peoplePanel.includes('loadMore'));
expect('people panel never renders email', !peoplePanel.toLowerCase().includes('email'));
expect('search route never renders email', !searchScreen.toLowerCase().includes('email'));
expect('public profile uses relationship button', publicView.includes('<RelationshipButton') && publicScreen.includes('followUser'));
expect('public favorites are read only', publicView.includes('readOnly'));
expect('public header is read only', publicView.includes('ProfileHeader profile={profile} readOnly'));
expect('edit profile has visibility controls', editScreen.includes('visibilityPrivate') && editScreen.includes('isPublic'));
expect('edit profile validates public username', editScreen.includes('canPublishProfile'));
expect(
  'profile tab has Find People row to Social People',
  profileTab.includes('<FindPeopleRow')
    && profileTab.includes('/(tabs)/social')
    && profileTab.includes("section: 'people'")
);
expect('find people sits near activity', profileTab.indexOf('ProfileActivitySection') < profileTab.indexOf('FindPeopleRow'));
expect('account settings no longer hosts find people button', !/PrimaryButton[\s\S]*social\.findPeople/.test(profileTab));
expect(
  'layout registers social routes',
  layout.includes('users/search')
    && layout.includes('user/[username]')
    && layout.includes('social/notifications')
);
expect('i18n social keys present', en.includes('"social"') && en.includes('"findPeopleSubtitle"') && en.includes('"visibilityPublic"'));
expect('i18n social home keys', en.includes('"homeTitle"') && en.includes('"feedEmptyTitle"') && en.includes('"sectionPeople"'));

const findPeopleRow = fs.readFileSync(path.join(__dirname, '..', 'src/components/social/FindPeopleRow.js'), 'utf8');
expect('find people row uses people icon', findPeopleRow.includes('people-outline') && findPeopleRow.includes('chevron-forward'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Social checks passed (${checks.length})`);
