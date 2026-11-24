import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  SOCIAL_LIST_PAGE_SIZE,
  SOCIAL_NOTIFICATIONS_PAGE_SIZE,
  SOCIAL_SEARCH_PAGE_SIZE,
  emptyRelationship,
  isSocialV2UnavailableError,
  normalizeConnectionCard,
  normalizeDiscoveryProfile,
  normalizeNotificationRow,
  normalizeRelationship,
} from './socialRules';

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function mapRpcError(error, fallback = 'generic') {
  if (!error) {
    return markCoded(fallback);
  }
  if (isSocialV2UnavailableError(error)) {
    return markCoded('social_v2_unavailable', error);
  }
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  if (/unauthenticated/i.test(message)) return markCoded('unauthenticated', error);
  if (/invalid_follow|invalid_target|invalid_args|invalid_request|invalid_username|invalid_notification/i.test(message)) {
    return markCoded('invalid_follow', error);
  }
  if (/profile_not_discoverable/i.test(message)) return markCoded('profile_not_discoverable', error);
  if (/profile_not_public/i.test(message)) return markCoded('profile_not_public', error);
  if (/profile_not_found|request_not_found/i.test(message)) return markCoded('profile_not_found', error);
  if (/not_request_recipient/i.test(message)) return markCoded('not_request_recipient', error);
  return markCoded(fallback, error);
}

async function requireUserId(supabase) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw markCoded('unauthenticated', error);
  }
  return data.user.id;
}

async function withAvatarUrl(card) {
  if (!card) {
    return card;
  }
  if (!card.avatarPath) {
    return { ...card, avatarUrl: null };
  }
  const signed = await createSignedProfileUrl(card.avatarPath);
  return { ...card, avatarUrl: signed?.url || null };
}

export async function getSocialRelationship(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('get_social_relationship', {
    p_target_id: targetUserId,
  });
  if (error) throw mapRpcError(error, 'relationship_failed');
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeRelationship(row);
}

export async function requestOrFollow(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('request_or_follow', {
    p_target_id: targetUserId,
  });
  if (error) throw mapRpcError(error, 'follow_failed');
  const row = Array.isArray(data) ? data[0] : data;
  return {
    action: row?.action || null,
    requestId: row?.request_id || row?.requestId || null,
    isFollowing: Boolean(row?.is_following ?? row?.isFollowing),
  };
}

export async function cancelFollowRequest(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('cancel_follow_request', {
    p_target_id: targetUserId,
  });
  if (error) throw mapRpcError(error, 'cancel_failed');
  return Boolean(data);
}

export async function acceptFollowRequest(requestId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('accept_follow_request', {
    p_request_id: requestId,
  });
  if (error) throw mapRpcError(error, 'accept_failed');
  return Boolean(data);
}

export async function rejectFollowRequest(requestId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('reject_follow_request', {
    p_request_id: requestId,
  });
  if (error) throw mapRpcError(error, 'reject_failed');
  return Boolean(data);
}

export async function listFollowConnections({
  userId,
  direction,
  offset = 0,
  limit = SOCIAL_LIST_PAGE_SIZE,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('list_follow_connections', {
    p_user_id: userId,
    p_direction: direction,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw mapRpcError(error, 'list_failed');
  const rows = Array.isArray(data) ? data : [];
  const items = await Promise.all(
    rows.map(async (row) => withAvatarUrl(normalizeConnectionCard(row)))
  );
  return {
    items: items.filter(Boolean),
    offset,
    hasMore: rows.length === Math.min(50, Math.max(1, limit)),
  };
}

export async function searchDiscoverableProfiles({
  query,
  offset = 0,
  limit = SOCIAL_SEARCH_PAGE_SIZE,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  const viewerId = await requireUserId(supabase);
  const { data, error } = await supabase.rpc('search_discoverable_profiles', {
    p_query: query,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) {
    // Fallback to Social V1 public-only search until migration is applied.
    if (isSocialV2UnavailableError(error)) {
      throw markCoded('social_v2_unavailable', error);
    }
    throw mapRpcError(error, 'search_failed');
  }
  const rows = Array.isArray(data) ? data : [];
  const items = await Promise.all(
    rows
      .filter((row) => row?.user_id !== viewerId)
      .map(async (row) => withAvatarUrl(normalizeDiscoveryProfile(row)))
  );
  return {
    items: items.filter(Boolean),
    offset,
    hasMore: rows.length === Math.min(50, Math.max(1, limit)),
  };
}

export async function fetchDiscoverableProfileCard(username) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('get_discoverable_profile_card', {
    p_username: username,
  });
  if (error) throw mapRpcError(error, 'profile_load_failed');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw markCoded('profile_not_found');
  return withAvatarUrl(normalizeDiscoveryProfile(row));
}

export async function listSocialNotifications({
  offset = 0,
  limit = SOCIAL_NOTIFICATIONS_PAGE_SIZE,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('list_social_notifications', {
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw mapRpcError(error, 'notifications_failed');
  const rows = Array.isArray(data) ? data : [];
  const items = await Promise.all(
    rows.map(async (row) => {
      const note = normalizeNotificationRow(row);
      if (!note) return null;
      const withUrl = await withAvatarUrl({
        avatarPath: note.actor.avatarPath,
      });
      return {
        ...note,
        actor: { ...note.actor, avatarUrl: withUrl.avatarUrl },
      };
    })
  );
  return {
    items: items.filter(Boolean),
    offset,
    hasMore: rows.length === Math.min(50, Math.max(1, limit)),
  };
}

export async function getUnreadSocialNotificationCount() {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('get_unread_social_notification_count');
  if (error) {
    if (isSocialV2UnavailableError(error)) return 0;
    throw mapRpcError(error, 'notifications_failed');
  }
  return Math.max(0, Number(data) || 0);
}

export async function markSocialNotificationRead(notificationId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { error } = await supabase.rpc('mark_social_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw mapRpcError(error, 'notifications_failed');
  return true;
}

export async function markAllSocialNotificationsRead() {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('mark_all_social_notifications_read');
  if (error) throw mapRpcError(error, 'notifications_failed');
  return Math.max(0, Number(data) || 0);
}

export async function countPendingFollowRequests() {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('count_pending_follow_requests');
  if (error) {
    if (isSocialV2UnavailableError(error)) return 0;
    throw mapRpcError(error, 'list_failed');
  }
  return Math.max(0, Number(data) || 0);
}

export function emptySocialRelationship() {
  return emptyRelationship();
}
