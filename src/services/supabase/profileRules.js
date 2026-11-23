export const PROFILE_BIO_MAX = 160;
export const PROFILE_DISPLAY_NAME_MAX = 80;
export const PROFILE_USERNAME_MIN = 3;
export const PROFILE_USERNAME_MAX = 24;
export const PROFILE_FAVORITES_LIMIT = 4;
export const PROFILE_MEDIA_BUCKET = 'profile-media';
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function normalizeBio(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, PROFILE_BIO_MAX);
}

export function isValidDisplayName(value) {
  const name = normalizeDisplayName(value);
  return name.length >= 1 && name.length <= PROFILE_DISPLAY_NAME_MAX;
}

export function isValidUsername(value) {
  const username = normalizeUsername(value);
  return new RegExp(`^[a-z0-9_]{${PROFILE_USERNAME_MIN},${PROFILE_USERNAME_MAX}}$`).test(username);
}

export function isValidBio(value) {
  if (value == null || value === '') {
    return true;
  }
  return typeof value === 'string' && value.trim().length <= PROFILE_BIO_MAX;
}

export function emptyProfile() {
  return {
    userId: null,
    displayName: '',
    username: '',
    bio: '',
    avatarPath: null,
    bannerPath: null,
    avatarUrl: null,
    bannerUrl: null,
    isPublic: false,
    updatedAt: null,
  };
}

export function normalizeProfileRow(row) {
  if (!row || typeof row !== 'object') {
    return emptyProfile();
  }
  return {
    userId: row.user_id || row.userId || null,
    displayName: normalizeDisplayName(row.display_name ?? row.displayName ?? ''),
    username: normalizeUsername(row.username ?? ''),
    bio: normalizeBio(row.bio ?? ''),
    avatarPath: row.avatar_path ?? row.avatarPath ?? null,
    bannerPath: row.banner_path ?? row.bannerPath ?? null,
    avatarUrl: row.avatarUrl ?? null,
    bannerUrl: row.bannerUrl ?? null,
    isPublic: Boolean(row.is_public ?? row.isPublic),
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

export function emptyFavorites() {
  return { shows: [], movies: [] };
}

export function normalizeFavoriteRow(row) {
  const mediaType = row?.media_type === 'movie' || row?.mediaType === 'movie' ? 'movie' : 'show';
  const mediaId = String(row?.media_id || row?.mediaId || '').trim();
  const position = Number(row?.position);
  if (!mediaId || !Number.isInteger(position) || position < 1 || position > PROFILE_FAVORITES_LIMIT) {
    return null;
  }
  if (mediaType === 'movie' && !/^trakt-movie-\d+$/.test(mediaId)) {
    return null;
  }
  if (mediaType === 'show' && !/^trakt-show-\d+$/.test(mediaId)) {
    return null;
  }
  return { mediaType, mediaId, position };
}

export function normalizeFavoritesList(rows, mediaType) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map(normalizeFavoriteRow)
    .filter((item) => item && item.mediaType === mediaType)
    .sort((left, right) => left.position - right.position)
    .slice(0, PROFILE_FAVORITES_LIMIT);
}

export function favoritesPayload(items) {
  return (items || [])
    .map((item, index) => ({
      media_id: item.mediaId || item.media_id,
      position: Number(item.position) || index + 1,
    }))
    .filter((item) => item.media_id && item.position >= 1 && item.position <= PROFILE_FAVORITES_LIMIT)
    .slice(0, PROFILE_FAVORITES_LIMIT);
}

export function canAddFavorite(items) {
  return (items || []).length < PROFILE_FAVORITES_LIMIT;
}

export function upsertFavoriteList(items, mediaId, position, mediaType) {
  const type = mediaType === 'movie' || mediaType === 'show'
    ? mediaType
    : (/^trakt-movie-/.test(mediaId) ? 'movie' : 'show');
  const next = normalizeFavoritesList(
    (items || []).map((item) => ({
      media_type: item.mediaType || type,
      media_id: item.mediaId,
      position: item.position,
    })),
    type
  ).filter((item) => item.mediaId !== mediaId);

  const slot = Number(position);
  const target = Number.isInteger(slot) && slot >= 1 && slot <= PROFILE_FAVORITES_LIMIT
    ? slot
    : (next.length + 1);
  if (target > PROFILE_FAVORITES_LIMIT && !items?.some((item) => item.position === target)) {
    return next;
  }
  const withoutSlot = next.filter((item) => item.position !== target);
  withoutSlot.push({
    mediaType: type,
    mediaId,
    position: Math.min(Math.max(target, 1), PROFILE_FAVORITES_LIMIT),
  });
  return withoutSlot
    .sort((left, right) => left.position - right.position)
    .slice(0, PROFILE_FAVORITES_LIMIT);
}

export function removeFavoriteAt(items, position) {
  return (items || [])
    .filter((item) => item.position !== position)
    .sort((left, right) => left.position - right.position)
    .map((item, index) => ({ ...item, position: index + 1 }));
}

export function reorderFavorites(items, fromPosition, toPosition) {
  const list = [...(items || [])].sort((left, right) => left.position - right.position);
  const fromIndex = list.findIndex((item) => item.position === fromPosition);
  const toIndex = list.findIndex((item) => item.position === toPosition);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return list.map((item, index) => ({ ...item, position: index + 1 }));
  }
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list.map((item, index) => ({ ...item, position: index + 1 }));
}

export function isOwnedMediaPath(userId, path, kind) {
  if (!userId || typeof path !== 'string' || (kind !== 'avatar' && kind !== 'banner')) {
    return false;
  }
  const prefix = `${String(userId).toLowerCase()}/${kind}/`;
  return path.toLowerCase().startsWith(prefix) && path.length > prefix.length;
}
