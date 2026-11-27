import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  formatRelativeTime,
  isSocialV2UnavailableError,
  normalizeDiscoveryProfile,
} from './socialRules';

export const PROFILE_REVIEWS_PAGE_SIZE = 20;
export const FRIENDS_RATINGS_PAGE_SIZE = 5;
export const PROFILE_REVIEW_FILTERS = ['all', 'movies', 'shows'];
export const FEED_ACTIVITY_FILTERS = ['all', 'watched', 'ratings', 'reviews'];

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function isSocialV5UnavailableError(error) {
  if (isSocialV2UnavailableError(error)) return true;
  const message = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return /list_profile_reviews|get_friends_media_ratings|list_following_activity_filtered|PGRST202|404|schema cache|social_v5_unavailable/i.test(
    message
  );
}

function mapRpcError(error, fallback = 'social_v5_failed') {
  if (isSocialV5UnavailableError(error)) {
    return markCoded('social_v5_unavailable', error);
  }
  const raw = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (/unauthenticated/.test(raw)) return markCoded('unauthenticated', error);
  if (/profile_not_found/.test(raw)) return markCoded('profile_not_found', error);
  if (/invalid_filter|invalid_profile_reviews|invalid_media/.test(raw)) {
    return markCoded('invalid_filter', error);
  }
  return markCoded(fallback, error);
}

async function requireUserId(supabase) {
  const local = await supabase.auth.getSession();
  const localId = local.data?.session?.user?.id;
  if (localId) return localId;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw markCoded('unauthenticated', error);
  }
  return data.user.id;
}

async function withAvatar(profile) {
  if (!profile?.avatarPath) {
    return { ...profile, avatarUrl: null };
  }
  const signed = await createSignedProfileUrl(profile.avatarPath);
  return {
    ...profile,
    avatarUrl: signed?.url || null,
  };
}

export function normalizeProfileReviewRow(row) {
  if (!row || typeof row !== 'object') return null;
  const mediaId = String(row.media_id || row.mediaId || '').trim();
  const mediaType = String(row.media_type || row.mediaType || '').trim();
  const reviewText = String(row.review_text || row.reviewText || '').trim();
  if (!mediaId || !mediaType || !reviewText) return null;
  const isPublished = Boolean(row.is_published ?? row.isPublished);
  return {
    id: row.id || null,
    activityId: row.activity_id ?? row.activityId ?? null,
    mediaType,
    mediaId,
    showMediaId: row.show_media_id || row.showMediaId || null,
    seasonNumber: row.season_number ?? row.seasonNumber ?? null,
    episodeNumber: row.episode_number ?? row.episodeNumber ?? null,
    rating: row.rating == null ? null : Number(row.rating),
    reviewText,
    containsSpoilers: Boolean(row.contains_spoilers ?? row.containsSpoilers),
    updatedAt: row.updated_at || row.updatedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    isPublished,
    isPrivate: !isPublished,
    likeCount: Math.max(0, Number(row.like_count ?? row.likeCount) || 0),
    commentCount: Math.max(0, Number(row.comment_count ?? row.commentCount) || 0),
    likedByViewer: Boolean(row.liked_by_viewer ?? row.likedByViewer),
    interactionsEnabled: Boolean(row.interactions_enabled ?? row.interactionsEnabled),
    relativeTime: formatRelativeTime(row.updated_at || row.updatedAt || row.created_at || row.createdAt),
  };
}

export function normalizeFriendsRatingItem(row) {
  if (!row || typeof row !== 'object') return null;
  const rating = row.rating == null ? null : Number(row.rating);
  if (rating == null || !Number.isFinite(rating)) return null;
  const actor = normalizeDiscoveryProfile({
    user_id: row.actor_user_id ?? row.actorUserId ?? row.actor_id,
    username: row.actor_username ?? row.actorUsername,
    display_name: row.actor_display_name ?? row.actorDisplayName,
    avatar_path: row.actor_avatar_path ?? row.actorAvatarPath,
    is_public: row.actor_is_public ?? row.actorIsPublic,
  });
  const reviewText = row.review_text || row.reviewText || null;
  return {
    activityId: row.activity_id ?? row.activityId ?? null,
    rating,
    createdAt: row.created_at || row.createdAt || null,
    reviewText: reviewText && String(reviewText).trim() ? String(reviewText).trim() : null,
    reviewContainsSpoilers: Boolean(
      row.review_contains_spoilers ?? row.reviewContainsSpoilers
    ),
    hasReview: Boolean(row.has_review ?? row.hasReview ?? (reviewText && String(reviewText).trim())),
    actor,
  };
}

export async function listProfileReviews({
  username,
  mediaFilter = 'all',
  limit = PROFILE_REVIEWS_PAGE_SIZE,
  cursorUpdatedAt = null,
  cursorId = null,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const filter = PROFILE_REVIEW_FILTERS.includes(mediaFilter) ? mediaFilter : 'all';
  const { data, error } = await supabase.rpc('list_profile_reviews', {
    p_username: String(username || '').trim(),
    p_media_filter: filter,
    p_limit: limit,
    p_cursor_updated_at: cursorUpdatedAt,
    p_cursor_id: cursorId,
  });
  if (error) throw mapRpcError(error, 'profile_reviews_failed');
  const rows = Array.isArray(data) ? data : [];
  const items = rows.map(normalizeProfileReviewRow).filter(Boolean);
  const pageSize = Math.min(30, Math.max(1, limit));
  const lastRaw = rows[rows.length - 1] || null;
  return {
    items,
    cursorUpdatedAt: lastRaw?.updated_at || lastRaw?.updatedAt || null,
    cursorId: lastRaw?.id || null,
    hasMore: rows.length >= pageSize,
  };
}

export async function getFriendsMediaRatings({
  mediaType,
  mediaId,
  limit = FRIENDS_RATINGS_PAGE_SIZE,
  offset = 0,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('get_friends_media_ratings', {
    p_media_type: mediaType,
    p_media_id: mediaId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw mapRpcError(error, 'friends_ratings_failed');
  const payload = data && typeof data === 'object' ? data : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = [];
  for (const row of rawItems) {
    const normalized = normalizeFriendsRatingItem(row);
    if (!normalized) continue;
    const actor = await withAvatar(normalized.actor);
    items.push({ ...normalized, actor });
  }
  const ratingCount = Math.max(0, Number(payload.rating_count ?? payload.ratingCount) || 0);
  const averageRaw = payload.average;
  const average = averageRaw == null || ratingCount === 0
    ? null
    : Number(averageRaw);
  return {
    mediaType: payload.media_type || mediaType,
    mediaId: payload.media_id || mediaId,
    average: average != null && Number.isFinite(average) ? average : null,
    ratingCount,
    items,
    hasMore: Boolean(payload.has_more ?? payload.hasMore),
    offset,
  };
}
