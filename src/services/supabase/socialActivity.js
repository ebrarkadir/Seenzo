import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  formatRelativeTime,
  isSocialV2UnavailableError,
  normalizeDiscoveryProfile,
} from './socialRules';

export const SOCIAL_ACTIVITY_PAGE_SIZE = 20;
export const SOCIAL_FEED_FILTERS = ['all', 'watched', 'ratings', 'reviews'];

const RATING_ACTIVITY_TYPES = new Set(['movie_rated', 'show_rated', 'episode_rated']);

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function mapRpcError(error, fallback = 'activity_feed_failed') {
  if (/list_following_activity_filtered|invalid_filter|social_v5/i.test(`${error?.message || ''} ${error?.code || ''}`)) {
    return markCoded('social_v5_unavailable', error);
  }
  if (isSocialV2UnavailableError(error) || /list_following_activity|publish_social_rating|PGRST202|404|schema cache/i.test(`${error?.message || ''} ${error?.code || ''}`)) {
    return markCoded('social_v3_unavailable', error);
  }
  return markCoded(fallback, error);
}

export function isSocialV5FeedUnavailableError(error) {
  return error?.code === 'social_v5_unavailable'
    || /list_following_activity_filtered|social_v5/i.test(`${error?.message || ''} ${error?.code || ''}`);
}

async function requireUserId(supabase) {
  // Prefer local session (same pattern as trackingSync) so publish does not hang on network getUser().
  const local = await supabase.auth.getSession();
  const localId = local.data?.session?.user?.id;
  if (localId) {
    return localId;
  }
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

export function normalizeActivityEventRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const activityType = String(row.activity_type || row.activityType || '');
  const mediaId = String(row.media_id || row.mediaId || '').trim();
  if (!activityType || !mediaId) {
    return null;
  }
  const actor = normalizeDiscoveryProfile({
    user_id: row.actor_user_id ?? row.actorUserId,
    username: row.actor_username ?? row.actorUsername,
    display_name: row.actor_display_name ?? row.actorDisplayName,
    avatar_path: row.actor_avatar_path ?? row.actorAvatarPath,
    is_public: row.actor_is_public ?? row.actorIsPublic,
  });
  const reviewText = /_rated$/.test(activityType)
    ? (row.review_text || row.reviewText || null)
    : null;
  const hasReview = Boolean(reviewText && String(reviewText).trim());
  const hasServerInteractionFields = (
    Object.prototype.hasOwnProperty.call(row, 'like_count')
    || Object.prototype.hasOwnProperty.call(row, 'likeCount')
    || Object.prototype.hasOwnProperty.call(row, 'interactions_enabled')
    || Object.prototype.hasOwnProperty.call(row, 'interactionsEnabled')
  );
  const interactionsFlag = row.interactions_enabled ?? row.interactionsEnabled;
  return {
    id: row.id,
    activityType,
    mediaType: row.media_type || row.mediaType || null,
    mediaId,
    showMediaId: row.show_media_id || row.showMediaId || null,
    seasonNumber: row.season_number ?? row.seasonNumber ?? null,
    episodeNumber: row.episode_number ?? row.episodeNumber ?? null,
    rating: row.rating == null ? null : Number(row.rating),
    createdAt: row.created_at || row.createdAt || null,
    reviewText,
    reviewContainsSpoilers: /_rated$/.test(activityType)
      ? Boolean(row.review_contains_spoilers ?? row.reviewContainsSpoilers)
      : false,
    likeCount: Math.max(0, Number(row.like_count ?? row.likeCount) || 0),
    commentCount: Math.max(0, Number(row.comment_count ?? row.commentCount) || 0),
    likedByViewer: Boolean(row.liked_by_viewer ?? row.likedByViewer),
    // Hide controls until Social V4 columns/RPCs are deployed — never invent eligibility.
    interactionsEnabled: hasServerInteractionFields
      ? (typeof interactionsFlag === 'boolean'
        ? interactionsFlag
        : (/_rated$/.test(activityType) && hasReview))
      : false,
    actor,
  };
}

async function normalizeActivityPage(rows, limit) {
  const items = [];
  for (const row of rows) {
    const normalized = normalizeActivityEventRow(row);
    if (!normalized) {
      continue;
    }
    const actor = await withAvatar(normalized.actor);
    items.push({
      ...normalized,
      actor,
      relativeTime: formatRelativeTime(normalized.createdAt),
    });
  }
  const pageSize = Math.min(30, Math.max(1, limit));
  const last = items[items.length - 1] || null;
  return {
    items,
    cursorCreatedAt: last?.createdAt || null,
    cursorId: last?.id || null,
    // Keyset continues while the server returned a full page (before client normalize drops).
    hasMore: rows.length >= pageSize,
  };
}

async function listFollowingActivityLegacy({
  limit,
  cursorCreatedAt,
  cursorId,
  supabase,
}) {
  const { data, error } = await supabase.rpc('list_following_activity', {
    p_limit: limit,
    p_cursor_created_at: cursorCreatedAt,
    p_cursor_id: cursorId,
  });
  if (error) {
    throw mapRpcError(error);
  }
  return normalizeActivityPage(Array.isArray(data) ? data : [], limit);
}

export async function listFollowingActivity({
  limit = SOCIAL_ACTIVITY_PAGE_SIZE,
  cursorCreatedAt = null,
  cursorId = null,
  filter = 'all',
} = {}) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  await requireUserId(supabase);
  const feedFilter = SOCIAL_FEED_FILTERS.includes(filter) ? filter : 'all';

  // Prefer filtered RPC (server-side filter before pagination). Fall back to
  // legacy unfiltered feed only for "all" when V5 is not deployed.
  const { data, error } = await supabase.rpc('list_following_activity_filtered', {
    p_filter: feedFilter,
    p_limit: limit,
    p_cursor_created_at: cursorCreatedAt,
    p_cursor_id: cursorId,
  });
  if (!error) {
    return normalizeActivityPage(Array.isArray(data) ? data : [], limit);
  }

  const mapped = mapRpcError(error);
  if (feedFilter === 'all' && (mapped.code === 'social_v5_unavailable' || mapped.code === 'social_v3_unavailable')) {
    // Retry classic V3/V4 feed when filtered RPC is missing.
    try {
      return await listFollowingActivityLegacy({
        limit,
        cursorCreatedAt,
        cursorId,
        supabase,
      });
    } catch (legacyError) {
      throw legacyError;
    }
  }
  if (mapped.code === 'social_v5_unavailable' && feedFilter !== 'all') {
    throw mapped;
  }
  throw mapped;
}

function normalizeRatingPayload({
  activityType,
  mediaId,
  showMediaId = null,
  seasonNumber = null,
  episodeNumber = null,
  rating = null,
} = {}) {
  if (!RATING_ACTIVITY_TYPES.has(activityType) || !mediaId) {
    return null;
  }
  if (activityType === 'movie_rated' && !/^trakt-movie-\d+$/.test(mediaId)) {
    return null;
  }
  if (activityType === 'show_rated' && !/^trakt-show-\d+$/.test(mediaId)) {
    return null;
  }
  if (activityType === 'episode_rated') {
    if (!/^trakt-episode-\d+$/.test(mediaId) || !showMediaId || !/^trakt-show-\d+$/.test(showMediaId)) {
      return null;
    }
  }
  let score = null;
  if (rating != null && rating !== '') {
    const value = Number(rating);
    if (!Number.isFinite(value) || value < 1 || value > 10) {
      return null;
    }
    score = value;
  }
  return {
    activityType,
    mediaId,
    showMediaId: activityType === 'episode_rated' ? showMediaId : null,
    seasonNumber: activityType === 'episode_rated' ? seasonNumber : null,
    episodeNumber: activityType === 'episode_rated' ? episodeNumber : null,
    rating: score,
  };
}

/**
 * Best-effort social rating publish. Never throws into tracking UX.
 * Returns the event uuid, null on no-op/unavailable, or { error } in __DEV__ only via console.
 */
export async function publishSocialRatingEvent(input = {}) {
  const payload = normalizeRatingPayload(input);
  if (!payload) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[social] rating_publish_skipped_invalid', input);
    }
    return null;
  }
  const supabase = getSupabase();
  if (!supabase) {
    return null;
  }
  try {
    await requireUserId(supabase);
    const { data, error } = await supabase.rpc('publish_social_rating_event', {
      p_activity_type: payload.activityType,
      p_media_id: payload.mediaId,
      p_show_media_id: payload.showMediaId,
      p_season_number: payload.seasonNumber,
      p_episode_number: payload.episodeNumber,
      p_rating: payload.rating,
    });
    if (error) {
      const mapped = mapRpcError(error);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[social] rating_publish_failed', {
          code: mapped.code,
          message: error.message,
          activityType: payload.activityType,
          mediaId: payload.mediaId,
        });
      }
      return null;
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[social] rating_publish_ok', {
        id: data,
        activityType: payload.activityType,
        mediaId: payload.mediaId,
        rating: payload.rating,
      });
    }
    return data || null;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[social] rating_publish_exception', error?.message || error);
    }
    return null;
  }
}

export function isSocialV3UnavailableError(error) {
  return error?.code === 'social_v3_unavailable'
    || isSocialV2UnavailableError(error)
    || /list_following_activity|publish_social_rating|social_v3/i.test(`${error?.message || ''} ${error?.code || ''}`);
}
