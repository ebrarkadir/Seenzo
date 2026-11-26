import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  formatRelativeTime,
  isSocialV2UnavailableError,
  normalizeDiscoveryProfile,
} from './socialRules';

export const SOCIAL_COMMENT_MAX_LENGTH = 300;
export const SOCIAL_COMMENTS_PAGE_SIZE = 30;

export const REPORT_TARGET = {
  PROFILE: 'profile',
  SOCIAL_ACTIVITY: 'social_activity',
  REVIEW_COMMENT: 'review_comment',
};

export const REPORT_REASON_KEYS = [
  'spam',
  'harassment',
  'hate',
  'inappropriate',
  'impersonation',
  'spoilers',
  'other',
];

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

async function requireUserId(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw markCoded('unauthenticated', error);
  }
  const userId = data?.session?.user?.id;
  if (!userId) {
    throw markCoded('unauthenticated');
  }
  return userId;
}

export function isSocialV4UnavailableError(error) {
  if (isSocialV2UnavailableError(error)) {
    return true;
  }
  const message = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return /like_review_activity|unlike_review_activity|list_review_comments|create_review_comment|get_review_interaction_summary|resolve_review_discussion_target|PGRST202|404|schema cache|social_v4_unavailable/i.test(
    message
  );
}

function mapRpcError(error, fallback = 'interaction_failed') {
  if (isSocialV4UnavailableError(error)) {
    return markCoded('social_v4_unavailable', error);
  }
  const raw = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (/unauthenticated/.test(raw)) return markCoded('unauthenticated', error);
  if (/comment_unavailable/.test(raw)) return markCoded('comment_unavailable', error);
  if (/activity_unavailable|parent_unavailable/.test(raw)) {
    return markCoded('activity_unavailable', error);
  }
  if (/cannot_like_own/.test(raw)) return markCoded('cannot_like_own', error);
  if (/invalid_comment|invalid_activity|invalid_parent|invalid_target|invalid_report/.test(raw)) {
    return markCoded('invalid_comment', error);
  }
  if (/reply_depth_exceeded/.test(raw)) return markCoded('reply_depth_exceeded', error);
  if (/report_rate_limited/.test(raw)) return markCoded('report_rate_limited', error);
  if (/comment_rate_limited/.test(raw)) return markCoded('comment_rate_limited', error);
  if (/already_reported/.test(raw)) return markCoded('already_reported', error);
  if (/cannot_report_self/.test(raw)) return markCoded('cannot_report_self', error);
  if (/profile_not_found/.test(raw)) return markCoded('profile_not_found', error);
  if (/not_authorized/.test(raw)) return markCoded('not_authorized', error);
  return markCoded(fallback, error);
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

export function normalizeInteractionSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const mediaId = String(payload.media_id || payload.mediaId || '').trim();
  const activityType = String(payload.activity_type || payload.activityType || '');
  if (!payload.id || !mediaId || !activityType) {
    return null;
  }
  const actor = normalizeDiscoveryProfile({
    user_id: payload.actor_user_id ?? payload.actorUserId,
    username: payload.actor_username ?? payload.actorUsername,
    display_name: payload.actor_display_name ?? payload.actorDisplayName,
    avatar_path: payload.actor_avatar_path ?? payload.actorAvatarPath,
    is_public: payload.actor_is_public ?? payload.actorIsPublic,
  });
  return {
    id: payload.id,
    activityType,
    mediaType: payload.media_type || payload.mediaType || null,
    mediaId,
    showMediaId: payload.show_media_id || payload.showMediaId || null,
    seasonNumber: payload.season_number ?? payload.seasonNumber ?? null,
    episodeNumber: payload.episode_number ?? payload.episodeNumber ?? null,
    rating: payload.rating == null ? null : Number(payload.rating),
    createdAt: payload.created_at || payload.createdAt || null,
    reviewText: payload.review_text || payload.reviewText || null,
    reviewContainsSpoilers: Boolean(
      payload.review_contains_spoilers ?? payload.reviewContainsSpoilers
    ),
    likeCount: Math.max(0, Number(payload.like_count ?? payload.likeCount) || 0),
    commentCount: Math.max(0, Number(payload.comment_count ?? payload.commentCount) || 0),
    likedByViewer: Boolean(payload.liked_by_viewer ?? payload.likedByViewer),
    interactionsEnabled: payload.interactions_enabled ?? payload.interactionsEnabled ?? true,
    isOwner: Boolean(payload.is_owner ?? payload.isOwner),
    actor,
  };
}

export function normalizeReviewCommentRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const id = row.id || null;
  const text = String(row.comment_text ?? row.commentText ?? '').trim();
  if (!id || !text) {
    return null;
  }
  const author = normalizeDiscoveryProfile({
    user_id: row.author_id ?? row.authorId,
    username: row.author_username ?? row.authorUsername,
    display_name: row.author_display_name ?? row.authorDisplayName,
    avatar_path: row.author_avatar_path ?? row.authorAvatarPath,
    is_public: row.author_is_public ?? row.authorIsPublic,
  });
  return {
    id,
    activityId: row.activity_id ?? row.activityId ?? null,
    authorId: row.author_id ?? row.authorId ?? null,
    parentCommentId: row.parent_comment_id ?? row.parentCommentId ?? null,
    commentText: text,
    containsSpoilers: Boolean(row.contains_spoilers ?? row.containsSpoilers),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    canDelete: Boolean(row.can_delete ?? row.canDelete),
    relativeTime: formatRelativeTime(row.created_at ?? row.createdAt),
    author,
  };
}

export function clampCommentText(value) {
  return String(value || '').slice(0, SOCIAL_COMMENT_MAX_LENGTH);
}

export function canSubmitComment(value) {
  const trimmed = String(value || '').trim();
  return trimmed.length >= 1 && trimmed.length <= SOCIAL_COMMENT_MAX_LENGTH;
}

export async function likeReviewActivity(activityId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('like_review_activity', {
    p_activity_id: activityId,
  });
  if (error) throw mapRpcError(error, 'like_failed');
  return {
    activityId: data?.activity_id || activityId,
    liked: Boolean(data?.liked ?? true),
    likeCount: Math.max(0, Number(data?.like_count) || 0),
  };
}

export async function unlikeReviewActivity(activityId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('unlike_review_activity', {
    p_activity_id: activityId,
  });
  if (error) throw mapRpcError(error, 'unlike_failed');
  return {
    activityId: data?.activity_id || activityId,
    liked: false,
    likeCount: data?.like_count == null ? null : Math.max(0, Number(data.like_count) || 0),
    unavailable: Boolean(data?.unavailable),
  };
}

export async function getReviewInteractionSummary(activityId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('get_review_interaction_summary', {
    p_activity_id: activityId,
  });
  if (error) throw mapRpcError(error, 'discussion_failed');
  const summary = normalizeInteractionSummary(data);
  if (!summary) throw markCoded('activity_unavailable');
  const actor = await withAvatar(summary.actor);
  return { ...summary, actor, relativeTime: formatRelativeTime(summary.createdAt) };
}

export async function listReviewComments({
  activityId,
  limit = SOCIAL_COMMENTS_PAGE_SIZE,
  cursorCreatedAt = null,
  cursorId = null,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('list_review_comments', {
    p_activity_id: activityId,
    p_limit: limit,
    p_cursor_created_at: cursorCreatedAt,
    p_cursor_id: cursorId,
  });
  if (error) throw mapRpcError(error, 'comments_failed');
  const rows = Array.isArray(data) ? data : [];
  const items = [];
  for (const row of rows) {
    const normalized = normalizeReviewCommentRow(row);
    if (!normalized) continue;
    const author = await withAvatar(normalized.author);
    items.push({ ...normalized, author });
  }
  const pageSize = Math.min(50, Math.max(1, limit));
  const last = items[items.length - 1] || null;
  return {
    items,
    cursorCreatedAt: last?.createdAt || null,
    cursorId: last?.id || null,
    hasMore: rows.length >= pageSize,
  };
}

export async function createReviewComment({
  activityId,
  commentText,
  containsSpoilers = false,
  parentCommentId = null,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  if (!canSubmitComment(commentText)) {
    throw markCoded('invalid_comment');
  }
  const { data, error } = await supabase.rpc('create_review_comment', {
    p_activity_id: activityId,
    p_comment_text: String(commentText).trim(),
    p_contains_spoilers: Boolean(containsSpoilers),
    p_parent_comment_id: parentCommentId || null,
  });
  if (error) throw mapRpcError(error, 'comment_failed');
  const normalized = normalizeReviewCommentRow({
    ...data,
    can_delete: true,
  });
  if (!normalized) throw markCoded('comment_failed');
  return normalized;
}

export async function deleteReviewComment(commentId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { error } = await supabase.rpc('delete_review_comment', {
    p_comment_id: commentId,
  });
  if (error) throw mapRpcError(error, 'delete_failed');
  return true;
}

export async function resolveReviewDiscussionTarget({ entityType, entityId } = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('resolve_review_discussion_target', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) throw mapRpcError(error, 'activity_unavailable');
  if (!data) throw markCoded('activity_unavailable');
  return data;
}

export async function reportSocialContent({ targetType, targetId, reason = null } = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  if (!targetType || !targetId) {
    throw markCoded('invalid_comment');
  }
  const { data, error } = await supabase.rpc('report_social_content', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
  });
  if (error) throw mapRpcError(error, 'report_failed');
  if (!data) throw markCoded('already_reported');
  return data;
}

export function isInteractionNotificationType(type) {
  return type === 'review_liked'
    || type === 'review_commented'
    || type === 'comment_replied';
}
