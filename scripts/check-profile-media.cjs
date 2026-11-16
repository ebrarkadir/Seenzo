const fs = require('fs');
const path = require('path');
const { decode } = require('base64-arraybuffer');

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
  'isOwnedMediaPath, PROFILE_IMAGE_MAX_BYTES, PROFILE_MEDIA_BUCKET, PROFILE_IMAGE_MIME'
);

const userId = '11111111-1111-1111-1111-111111111111';
expect(
  'owned avatar path case-insensitive',
  rules.isOwnedMediaPath(userId.toUpperCase(), `${userId}/avatar/token.jpg`, 'avatar'),
  true
);
expect(
  'rejects wrong kind folder',
  rules.isOwnedMediaPath(userId, `${userId}/banner/token.jpg`, 'avatar'),
  false
);
expect('bucket name', rules.PROFILE_MEDIA_BUCKET, 'profile-media');
expect('max bytes 5mb', rules.PROFILE_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
expect('jpeg allowed', rules.PROFILE_IMAGE_MIME.has('image/jpeg'), true);

const tinyJpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
const bytes = decode(tinyJpegBase64);
expect('base64 decode yields ArrayBuffer', bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes), true);
expect('decoded bytes non-empty', bytes.byteLength > 0, true);
expect('decoded under limit', bytes.byteLength <= rules.PROFILE_IMAGE_MAX_BYTES, true);

const mediaSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/profileMedia.js'), 'utf8');
expect('uses expo-file-system legacy base64 read', mediaSource.includes('expo-file-system/legacy') && mediaSource.includes('EncodingType.Base64'));
expect('uses base64-arraybuffer decode', mediaSource.includes("from 'base64-arraybuffer'") && mediaSource.includes('decode('));
expect('uploads ArrayBuffer to profile-media', mediaSource.includes('.upload(path, prepared.bytes') && mediaSource.includes('PROFILE_MEDIA_BUCKET'));
expect('never uses getPublicUrl', !mediaSource.includes('getPublicUrl'));
expect('createSignedUrl required option', mediaSource.includes('createSignedUrl') && mediaSource.includes('required'));
expect('checks auth session before upload', mediaSource.includes('getSession()'));
expect('path lowercases user id', mediaSource.includes('.toLowerCase()'));

const profileSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/profile.js'), 'utf8');
expect('image path update helper exists', profileSource.includes('updateOwnProfileMediaPaths'));
expect('image save does not require username fields', profileSource.includes('replaceProfileImageAndSave') && profileSource.includes('updateOwnProfileMediaPaths'));
expect('orphan cleanup on db failure', profileSource.includes('removeProfileObject(uploadedPath)'));
expect('signed urls required after image save', profileSource.includes('requireUrls: true'));

const editSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/edit-profile.js'), 'utf8');
expect('edit form stable remount key', editSource.includes('key={userId}') && !editSource.includes('profile.updatedAt || \'new\''));
expect('edit form reseeds after profile load', editSource.includes('seedKey') && editSource.includes('!dirty'));
expect('local preview before upload completes', editSource.includes('setPreview') && editSource.includes('asset.uri'));
expect('photo uploads on select documented', editSource.includes('photoUploadsOnSelect'));
expect('keeps preview on upload failure', editSource.includes('setLocalError') && editSource.includes('upload_failed'));

const contextSource = fs.readFileSync(path.join(__dirname, '..', 'src/profile/ProfileContext.js'), 'utf8');
expect('uploadAndSaveImage no longer passes profile text fields', /uploadAndSaveImage = useCallback\(async \(kind, asset\) =>/.test(contextSource));
expect('removeImage uses media path helper', contextSource.includes('updateOwnProfileMediaPaths'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Profile media checks passed (${checks.length})`);
