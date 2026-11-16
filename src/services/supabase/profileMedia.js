import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getSupabase } from './client';
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MIME,
  PROFILE_MEDIA_BUCKET,
  isOwnedMediaPath,
} from './profileRules';

const SIGNED_TTL_SECONDS = 60 * 60;
const AVATAR_MAX_EDGE = 720;
const BANNER_MAX_WIDTH = 1600;
const BANNER_MAX_HEIGHT = 640;

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function mediaDebug(stage, detail = {}) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const safe = { stage };
  if (detail.kind) safe.kind = detail.kind;
  if (detail.mimeType) safe.mimeType = detail.mimeType;
  if (typeof detail.byteLength === 'number') safe.byteLength = detail.byteLength;
  if (detail.pathKind) safe.pathKind = detail.pathKind;
  if (detail.code) safe.code = detail.code;
  if (detail.message) safe.message = String(detail.message).slice(0, 160);
  console.log('[profile-media]', safe);
}

function extensionForMime(mime) {
  if (mime === 'image/png') {
    return 'png';
  }
  if (mime === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function randomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readLocalImageAsArrayBuffer(uri) {
  if (!uri) {
    throw markCoded('invalid_image');
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64) {
    throw markCoded('invalid_image');
  }
  const bytes = decode(base64);
  if (!bytes?.byteLength) {
    throw markCoded('invalid_image');
  }
  return bytes;
}

export async function requestMediaLibraryPermission() {
  const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return result.granted || result.status === 'granted';
}

export async function pickProfileImage(kind = 'avatar') {
  const granted = await requestMediaLibraryPermission();
  if (!granted) {
    throw markCoded('permission_denied');
  }
  const aspect = kind === 'banner' ? [3, 1] : [1, 1];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets?.length) {
    return null;
  }
  const asset = result.assets[0];
  const mime = asset.mimeType || 'image/jpeg';
  if (!PROFILE_IMAGE_MIME.has(mime)) {
    throw markCoded('unsupported_type');
  }
  mediaDebug('image_selected', { kind, mimeType: mime, byteLength: asset.fileSize || undefined });
  return {
    uri: asset.uri,
    mimeType: mime,
    width: asset.width || null,
    height: asset.height || null,
    fileSize: asset.fileSize || null,
  };
}

export async function prepareProfileImage(asset, kind = 'avatar') {
  if (!asset?.uri) {
    throw markCoded('invalid_image');
  }
  const maxWidth = kind === 'banner' ? BANNER_MAX_WIDTH : AVATAR_MAX_EDGE;
  const maxHeight = kind === 'banner' ? BANNER_MAX_HEIGHT : AVATAR_MAX_EDGE;
  const actions = [];
  if (asset.width && asset.height && (asset.width > maxWidth || asset.height > maxHeight)) {
    const widthRatio = maxWidth / asset.width;
    const heightRatio = maxHeight / asset.height;
    const ratio = Math.min(widthRatio, heightRatio);
    actions.push({
      resize: {
        width: Math.max(1, Math.round(asset.width * ratio)),
        height: Math.max(1, Math.round(asset.height * ratio)),
      },
    });
  }
  const compressed = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    {
      compress: 0.82,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  const bytes = await readLocalImageAsArrayBuffer(compressed.uri);
  if (bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) {
    mediaDebug('image_too_large', { kind, byteLength: bytes.byteLength });
    throw markCoded('file_too_large');
  }
  mediaDebug('image_processed', {
    kind,
    mimeType: 'image/jpeg',
    byteLength: bytes.byteLength,
  });
  return {
    uri: compressed.uri,
    mimeType: 'image/jpeg',
    bytes,
    byteLength: bytes.byteLength,
  };
}

export function buildProfileObjectPath(userId, kind, mimeType = 'image/jpeg') {
  const safeUserId = String(userId || '').toLowerCase();
  if (!safeUserId || (kind !== 'avatar' && kind !== 'banner')) {
    throw markCoded('invalid_path');
  }
  return `${safeUserId}/${kind}/${randomToken()}.${extensionForMime(mimeType)}`;
}

export async function uploadProfileImage({ userId, kind, asset, onProgress }) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw markCoded('unauthenticated', sessionError);
  }
  if (typeof onProgress === 'function') {
    onProgress(0.15);
  }
  const prepared = await prepareProfileImage(asset, kind);
  if (typeof onProgress === 'function') {
    onProgress(0.45);
  }
  const path = buildProfileObjectPath(userId, kind, prepared.mimeType);
  if (!isOwnedMediaPath(userId, path, kind)) {
    throw markCoded('invalid_path');
  }
  const { error } = await supabase.storage
    .from(PROFILE_MEDIA_BUCKET)
    .upload(path, prepared.bytes, {
      contentType: prepared.mimeType,
      upsert: false,
      cacheControl: '3600',
    });
  if (error) {
    mediaDebug('storage_upload_failed', {
      kind,
      code: error.statusCode || error.error || 'upload_failed',
      message: error.message,
      byteLength: prepared.byteLength,
    });
    throw markCoded('upload_failed', error);
  }
  if (typeof onProgress === 'function') {
    onProgress(1);
  }
  mediaDebug('storage_upload_ok', {
    kind,
    pathKind: kind,
    mimeType: prepared.mimeType,
    byteLength: prepared.byteLength,
  });
  return { path, mimeType: prepared.mimeType, byteLength: prepared.byteLength };
}

export async function createSignedProfileUrl(path, ttlSeconds = SIGNED_TTL_SECONDS, options = {}) {
  const required = Boolean(options.required);
  if (!path) {
    if (required) {
      throw markCoded('signed_url_failed');
    }
    return null;
  }
  const supabase = getSupabase();
  if (!supabase) {
    if (required) {
      throw markCoded('config');
    }
    return null;
  }
  const { data, error } = await supabase.storage
    .from(PROFILE_MEDIA_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    mediaDebug('signed_url_failed', {
      code: error?.statusCode || error?.error || 'signed_url_failed',
      message: error?.message,
    });
    if (required) {
      throw markCoded('signed_url_failed', error);
    }
    return null;
  }
  mediaDebug('signed_url_ok', { pathKind: path.includes('/banner/') ? 'banner' : 'avatar' });
  return {
    url: data.signedUrl,
    expiresAt: Date.now() + (ttlSeconds - 60) * 1000,
  };
}

export async function removeProfileObject(path) {
  if (!path) {
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    return;
  }
  await supabase.storage.from(PROFILE_MEDIA_BUCKET).remove([path]);
}
