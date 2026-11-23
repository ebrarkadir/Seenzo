const fs = require('fs');
const path = require('path');

function loadModule(relativePath, returned) {
  const file = path.join(__dirname, '..', relativePath);
  const code = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export \{[^}]+\};?\s*$/gm, '')
    .replace(/^export /gm, '');
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

const rules = loadModule(
  'src/services/supabase/profileRules.js',
  [
    'normalizeDisplayName',
    'normalizeUsername',
    'normalizeBio',
    'isValidDisplayName',
    'isValidUsername',
    'isValidBio',
    'normalizeFavoritesList',
    'upsertFavoriteList',
    'removeFavoriteAt',
    'reorderFavorites',
    'canAddFavorite',
    'isOwnedMediaPath',
    'PROFILE_FAVORITES_LIMIT',
    'favoritesPayload',
  ].join(', ')
);

expect('display name trims', rules.normalizeDisplayName('  Ada  Lovelace  '), 'Ada Lovelace');
expect('username lowercases and strips @', rules.normalizeUsername('@Ada_One'), 'ada_one');
expect('bio truncates to 160', rules.normalizeBio('x'.repeat(200)).length, 160);
expect('valid username accepted', rules.isValidUsername('seenzo_fan'), true);
expect('short username rejected', rules.isValidUsername('ab'), false);
expect('username with spaces rejected', rules.isValidUsername('ada one'), false);
expect('empty display name rejected', rules.isValidDisplayName('   '), false);
expect('bio optional ok', rules.isValidBio(''), true);

const favorites = rules.normalizeFavoritesList([
  { media_type: 'show', media_id: 'trakt-show-1', position: 2 },
  { media_type: 'show', media_id: 'trakt-show-2', position: 1 },
  { media_type: 'movie', media_id: 'trakt-movie-9', position: 1 },
], 'show');
expect('favorites filter by type and sort', favorites.map((item) => item.mediaId), ['trakt-show-2', 'trakt-show-1']);

let list = [];
list = rules.upsertFavoriteList(list, 'trakt-show-10', 1, 'show');
list = rules.upsertFavoriteList(list, 'trakt-show-11', 2, 'show');
list = rules.upsertFavoriteList(list, 'trakt-show-12', 3, 'show');
list = rules.upsertFavoriteList(list, 'trakt-show-13', 4, 'show');
expect('four favorites allowed', list.length, 4);
expect('cannot conceptually exceed limit without replace', rules.canAddFavorite(list), false);
list = rules.upsertFavoriteList(list, 'trakt-show-99', 2, 'show');
expect('replace keeps four slots', list.length, 4);
expect('replace updates position 2', list.find((item) => item.position === 2).mediaId, 'trakt-show-99');
list = rules.removeFavoriteAt(list, 1);
expect('remove compact positions', list.map((item) => item.position), [1, 2, 3]);
list = rules.reorderFavorites(list, 1, 3);
expect('reorder moves item', list.map((item) => item.mediaId)[2], 'trakt-show-99');
expect('owned avatar path accepted', rules.isOwnedMediaPath('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111/avatar/a.jpg', 'avatar'), true);
expect('foreign avatar path rejected', rules.isOwnedMediaPath('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222/avatar/a.jpg', 'avatar'), false);
expect('favorites payload uses snake keys', rules.favoritesPayload([{ mediaId: 'trakt-show-1', position: 1 }]), [{ media_id: 'trakt-show-1', position: 1 }]);
expect('favorites limit constant', rules.PROFILE_FAVORITES_LIMIT, 4);

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261116170000_profile_favorites_and_media.sql'), 'utf8');
expect('migration extends profiles', migration.includes('add column if not exists username text'));
expect('migration creates profile_favorites', migration.includes('create table if not exists public.profile_favorites'));
expect('migration enforces max four positions', migration.includes('position between 1 and 4'));
expect('migration has unique media per user type', migration.includes('profile_favorites_user_type_media_key'));
expect('migration has set_profile_favorites rpc', migration.includes('create or replace function public.set_profile_favorites'));
expect('migration creates private profile-media bucket', migration.includes("'profile-media'") && migration.includes('public, file_size_limit'));
expect('migration scopes storage to auth uid folder', migration.includes("(storage.foldername(name))[1] = (select auth.uid()::text)"));

const profileScreen = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/profile.js'), 'utf8');
const editScreen = fs.readFileSync(path.join(__dirname, '..', 'src/app/edit-profile.js'), 'utf8');
const context = fs.readFileSync(path.join(__dirname, '..', 'src/profile/ProfileContext.js'), 'utf8');
const media = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/profileMedia.js'), 'utf8');
expect('profile tab renders favorite shelves', profileScreen.includes('<FavoriteShelf') && profileScreen.includes('favoriteShows'));
expect('profile tab renders my activity once', (profileScreen.match(/<ProfileActivitySection/g) || []).length === 1);
expect('profile has no my library section', !profileScreen.includes('ProfileLibrarySection') && !profileScreen.includes('ProfileStatsRow'));
expect('activity opens archives and ratings', profileScreen.includes("/archive/shows") && profileScreen.includes("/archive/movies") && profileScreen.includes("/personal-ratings"));
expect('activity opens insights', profileScreen.includes("router.push('/insights')"));
expect('profile tab clears via auth scoped profile context', context.includes("key={userId || 'guest'}") && context.includes("userId ? profile : emptyProfile()"));
expect('edit profile validates username uniqueness conflict code', editScreen.includes('username_taken') || editScreen.includes('profile.errors'));
expect('uploads use base64 ArrayBuffer strategy', media.includes('base64-arraybuffer') && media.includes('EncodingType.Base64') && media.includes('.upload('));
expect('uploads never delete before save helper used', context.includes('replaceProfileImageAndSave') || media.includes('uploadProfileImage'));
expect('edit profile uses stable form key', editScreen.includes('key={userId}'));
expect('demo ratings excluded for signed-in demo mode', profileScreen.includes('signedIn && demoMode'));

const activityUi = fs.readFileSync(path.join(__dirname, '..', 'src/components/profile/ProfileActivitySection.js'), 'utf8');
expect('activity section has three interactive cards', activityUi.includes('tv-outline') && activityUi.includes('film-outline') && activityUi.includes('icon="star"'));
expect('activity section heading is my activity', activityUi.includes('profile.myActivity'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Profile checks passed (${checks.length})`);
