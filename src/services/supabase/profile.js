import { getSupabase } from './client';
import { createSignedProfileUrl, removeProfileObject } from './profileMedia';
import {
  emptyFavorites,
  emptyProfile,
  favoritesPayload,
  isValidBio,
  isValidDisplayName,
  isValidUsername,
  normalizeBio,
  normalizeDisplayName,
  normalizeFavoriteRow,
  normalizeFavoritesList,
  normalizeProfileRow,
  normalizeUsername,
} from './profileRules';
import { canEnableDiscovery, canPublishProfile } from './socialRules';

const PROFILE_COLUMNS = 'user_id, display_name, username, bio, avatar_path, banner_path, is_public, allow_profile_discovery, share_activity_with_followers, updated_at';
const PROFILE_COLUMNS_LEGACY = 'user_id, display_name, username, bio, avatar_path, banner_path, is_public, updated_at';
const PROFILE_COLUMNS_V2 = 'user_id, display_name, username, bio, avatar_path, banner_path, is_public, allow_profile_discovery, updated_at';

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function mapProfileError(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  if (/profiles_username_lower_key|duplicate key.*username/i.test(message)) {
    return markCoded('username_taken', error);
  }
  if (/profiles_username_format/i.test(message)) {
    return markCoded('invalid_username', error);
  }
  if (/profiles_bio_length|profiles_display_name_length/i.test(message)) {
    return markCoded('invalid_profile', error);
  }
  return markCoded('profile_save_failed', error);
}

async function withSignedUrls(profile, options = {}) {
  const requireUrls = Boolean(options.requireUrls);
  const next = { ...profile };
  if (profile.avatarPath) {
    const signed = await createSignedProfileUrl(profile.avatarPath, undefined, { required: requireUrls });
    next.avatarUrl = signed?.url || null;
    next.avatarExpiresAt = signed?.expiresAt || null;
    if (requireUrls && !next.avatarUrl) {
      throw markCoded('signed_url_failed');
    }
  } else {
    next.avatarUrl = null;
    next.avatarExpiresAt = null;
  }
  if (profile.bannerPath) {
    const signed = await createSignedProfileUrl(profile.bannerPath, undefined, { required: requireUrls });
    next.bannerUrl = signed?.url || null;
    next.bannerExpiresAt = signed?.expiresAt || null;
    if (requireUrls && !next.bannerUrl) {
      throw markCoded('signed_url_failed');
    }
  } else {
    next.bannerUrl = null;
    next.bannerExpiresAt = null;
  }
  return next;
}

async function ensureOwnProfileRow(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw markCoded('profile_load_failed', error);
  }
  if (data) {
    return data;
  }
  const { data: created, error: createError } = await supabase
    .from('profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })
    .select(PROFILE_COLUMNS)
    .single();
  if (createError) {
    throw markCoded('profile_load_failed', createError);
  }
  return created;
}

export async function fetchOwnProfile() {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw markCoded('unauthenticated', authError);
  }
  const userId = authData.user.id;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Older databases without Social V3 sharing column still load Social V2 columns.
    if (/share_activity_with_followers|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
      const v2 = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS_V2)
        .eq('user_id', userId)
        .maybeSingle();
      if (!v2.error && v2.data) {
        return withSignedUrls(normalizeProfileRow({
          ...v2.data,
          share_activity_with_followers: false,
        }));
      }
    }
    // Older databases without Social V2 discovery column still load Social V1 columns.
    if (/allow_profile_discovery|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
      const legacyV2 = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS_LEGACY)
        .eq('user_id', userId)
        .maybeSingle();
      if (!legacyV2.error && legacyV2.data) {
        return withSignedUrls(normalizeProfileRow({
          ...legacyV2.data,
          allow_profile_discovery: false,
          share_activity_with_followers: false,
        }));
      }
    }
    // Older databases without is_public still load core columns.
    if (/is_public|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
      const legacy = await supabase
        .from('profiles')
        .select('user_id, display_name, username, bio, avatar_path, banner_path, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (legacy.error) {
        throw markCoded('profile_load_failed', legacy.error);
      }
      return withSignedUrls(normalizeProfileRow({ ...legacy.data, is_public: false }));
    }
    throw markCoded('profile_load_failed', error);
  }
  if (!data) {
    const { data: created, error: createError } = await supabase
      .from('profiles')
      .upsert({ user_id: userId }, { onConflict: 'user_id' })
      .select(PROFILE_COLUMNS)
      .single();
    if (createError) {
      if (/allow_profile_discovery|42703/i.test(`${createError.message || ''} ${createError.code || ''}`)) {
        const legacyCreate = await supabase
          .from('profiles')
          .upsert({ user_id: userId }, { onConflict: 'user_id' })
          .select(PROFILE_COLUMNS_LEGACY)
          .single();
        if (legacyCreate.error) {
          throw markCoded('profile_load_failed', legacyCreate.error);
        }
        return withSignedUrls(normalizeProfileRow({
          ...legacyCreate.data,
          allow_profile_discovery: false,
        }));
      }
      throw markCoded('profile_load_failed', createError);
    }
    return withSignedUrls(normalizeProfileRow(created));
  }
  return withSignedUrls(normalizeProfileRow(data));
}

export async function refreshProfileImageUrls(profile) {
  if (!profile) {
    return emptyProfile();
  }
  const needsAvatar = profile.avatarPath && (!profile.avatarUrl || (profile.avatarExpiresAt && Date.now() > profile.avatarExpiresAt));
  const needsBanner = profile.bannerPath && (!profile.bannerUrl || (profile.bannerExpiresAt && Date.now() > profile.bannerExpiresAt));
  if (!needsAvatar && !needsBanner) {
    return profile;
  }
  return withSignedUrls(profile);
}

export async function updateOwnProfile(input) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw markCoded('unauthenticated', authError);
  }
  const userId = authData.user.id;
  const displayName = normalizeDisplayName(input.displayName);
  const username = normalizeUsername(input.username);
  const bio = normalizeBio(input.bio);
  if (!isValidDisplayName(displayName)) {
    throw markCoded('invalid_display_name');
  }
  if (!isValidUsername(username)) {
    throw markCoded('invalid_username');
  }
  if (!isValidBio(bio)) {
    throw markCoded('invalid_bio');
  }
  const isPublic = Object.prototype.hasOwnProperty.call(input, 'isPublic')
    ? Boolean(input.isPublic)
    : undefined;
  const allowProfileDiscovery = Object.prototype.hasOwnProperty.call(input, 'allowProfileDiscovery')
    ? Boolean(input.allowProfileDiscovery)
    : undefined;
  const shareActivityWithFollowers = Object.prototype.hasOwnProperty.call(input, 'shareActivityWithFollowers')
    ? Boolean(input.shareActivityWithFollowers)
    : undefined;
  if (isPublic != null && !canPublishProfile({ username, isPublic })) {
    throw markCoded('public_requires_username');
  }
  if (
    allowProfileDiscovery != null
    && !canEnableDiscovery({ username, allowProfileDiscovery })
  ) {
    throw markCoded('discovery_requires_username');
  }

  const patch = {
    display_name: displayName,
    username,
    bio: bio || null,
  };
  if (isPublic != null) {
    patch.is_public = isPublic;
    // Public profiles are already searchable; discovery flag is for private opt-in.
    if (isPublic) {
      patch.allow_profile_discovery = false;
    }
  }
  if (allowProfileDiscovery != null && isPublic !== true) {
    patch.allow_profile_discovery = allowProfileDiscovery;
  }
  if (shareActivityWithFollowers != null) {
    patch.share_activity_with_followers = shareActivityWithFollowers;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'avatarPath')) {
    patch.avatar_path = input.avatarPath || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'bannerPath')) {
    patch.banner_path = input.bannerPath || null;
  }

  let { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error && /share_activity_with_followers|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
    const v2Patch = { ...patch };
    delete v2Patch.share_activity_with_followers;
    const v2 = await supabase
      .from('profiles')
      .update(v2Patch)
      .eq('user_id', userId)
      .select(PROFILE_COLUMNS_V2)
      .single();
    data = v2.data ? { ...v2.data, share_activity_with_followers: false } : null;
    error = v2.error;
  }
  if (error && /allow_profile_discovery|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
    const legacyPatch = { ...patch };
    delete legacyPatch.allow_profile_discovery;
    delete legacyPatch.share_activity_with_followers;
    const legacy = await supabase
      .from('profiles')
      .update(legacyPatch)
      .eq('user_id', userId)
      .select(PROFILE_COLUMNS_LEGACY)
      .single();
    data = legacy.data
      ? { ...legacy.data, allow_profile_discovery: false, share_activity_with_followers: false }
      : null;
    error = legacy.error;
  }
  if (error) {
    if (/profiles_public_requires_username|profiles_discovery_requires_username/i.test(`${error.message || ''} ${error.details || ''}`)) {
      throw markCoded(
        /discovery/i.test(`${error.message || ''} ${error.details || ''}`)
          ? 'discovery_requires_username'
          : 'public_requires_username',
        error
      );
    }
    throw mapProfileError(error);
  }
  return withSignedUrls(normalizeProfileRow(data));
}

export async function updateOwnProfileMediaPaths(input) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw markCoded('unauthenticated', authError);
  }
  const userId = authData.user.id;
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, 'avatarPath')) {
    patch.avatar_path = input.avatarPath || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'bannerPath')) {
    patch.banner_path = input.bannerPath || null;
  }
  if (!Object.keys(patch).length) {
    throw markCoded('invalid_profile');
  }

  await ensureOwnProfileRow(supabase, userId);

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) {
    throw mapProfileError(error);
  }
  if (!data) {
    throw markCoded('profile_save_failed');
  }
  return normalizeProfileRow(data);
}

export async function fetchOwnFavorites() {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw markCoded('unauthenticated', authError);
  }
  const { data, error } = await supabase
    .from('profile_favorites')
    .select('media_type, media_id, position')
    .eq('user_id', authData.user.id)
    .order('position', { ascending: true });
  if (error) {
    if (/schema cache|does not exist|PGRST/i.test(`${error.message || ''} ${error.code || ''}`)) {
      throw markCoded('favorites_unavailable', error);
    }
    throw markCoded('favorites_load_failed', error);
  }
  return {
    shows: normalizeFavoritesList(data, 'show'),
    movies: normalizeFavoritesList(data, 'movie'),
  };
}

export async function saveOwnFavorites(mediaType, items) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  if (mediaType !== 'movie' && mediaType !== 'show') {
    throw markCoded('invalid_media_type');
  }
  const payload = favoritesPayload(items);
  const { data, error } = await supabase.rpc('set_profile_favorites', {
    p_media_type: mediaType,
    p_items: payload,
  });
  if (error) {
    const message = `${error.message || ''} ${error.details || ''}`;
    if (/favorites_limit/i.test(message)) {
      throw markCoded('favorites_limit', error);
    }
    if (/duplicate_media/i.test(message)) {
      throw markCoded('duplicate_media', error);
    }
    if (/schema cache|does not exist|PGRST/i.test(message)) {
      throw markCoded('favorites_unavailable', error);
    }
    throw markCoded('favorites_save_failed', error);
  }
  return normalizeFavoritesList(data, mediaType);
}

export async function replaceProfileImageAndSave({
  kind,
  uploadedPath,
  previousPath,
}) {
  let savedProfile;
  try {
    savedProfile = await updateOwnProfileMediaPaths(
      kind === 'avatar' ? { avatarPath: uploadedPath } : { bannerPath: uploadedPath }
    );
  } catch (error) {
    await removeProfileObject(uploadedPath).catch(() => {});
    throw error;
  }
  if (previousPath && previousPath !== uploadedPath) {
    removeProfileObject(previousPath).catch(() => {});
  }
  return withSignedUrls(savedProfile, { requireUrls: true });
}

export function clearLocalProfileState() {
  return {
    profile: emptyProfile(),
    favorites: emptyFavorites(),
  };
}

export function parseFavoriteRows(rows) {
  return (rows || []).map(normalizeFavoriteRow).filter(Boolean);
}
