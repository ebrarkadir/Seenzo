import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  isSocialV2UnavailableError,
  normalizeDiscoveryProfile,
} from './socialRules';

export const BLOCKED_USERS_PAGE_SIZE = 30;

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function isSocialBlocksUnavailableError(error) {
  if (isSocialV2UnavailableError(error)) return true;
  const message = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
  return /block_user|unblock_user|list_blocked_users|user_blocks|PGRST202|404|schema cache|social_blocks_unavailable/i.test(
    message
  );
}

function mapRpcError(error, fallback = 'block_failed') {
  if (isSocialBlocksUnavailableError(error)) {
    return markCoded('social_blocks_unavailable', error);
  }
  const raw = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (/unauthenticated/.test(raw)) return markCoded('unauthenticated', error);
  if (/cannot_block_self/.test(raw)) return markCoded('cannot_block_self', error);
  if (/blocked/.test(raw)) return markCoded('blocked', error);
  if (/profile_not_found|invalid_target/.test(raw)) return markCoded('profile_not_found', error);
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

export function normalizeBlockedUserRow(row) {
  if (!row || typeof row !== 'object') return null;
  const profile = normalizeDiscoveryProfile({
    user_id: row.user_id ?? row.userId,
    username: row.username,
    display_name: row.display_name ?? row.displayName,
    avatar_path: row.avatar_path ?? row.avatarPath,
    is_public: row.is_public ?? row.isPublic,
    allow_profile_discovery: row.allow_profile_discovery ?? row.allowProfileDiscovery,
  });
  if (!profile?.userId) return null;
  return {
    ...profile,
    blockedAt: row.blocked_at || row.blockedAt || null,
  };
}

export async function blockUser(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { error } = await supabase.rpc('block_user', {
    p_target_id: targetUserId,
  });
  if (error) throw mapRpcError(error, 'block_failed');
  return true;
}

export async function unblockUser(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { error } = await supabase.rpc('unblock_user', {
    p_target_id: targetUserId,
  });
  if (error) throw mapRpcError(error, 'unblock_failed');
  return true;
}

export async function listBlockedUsers({
  offset = 0,
  limit = BLOCKED_USERS_PAGE_SIZE,
} = {}) {
  const supabase = getSupabase();
  if (!supabase) throw markCoded('config');
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc('list_blocked_users', {
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw mapRpcError(error, 'list_failed');
  const rows = Array.isArray(data) ? data : [];
  const items = [];
  for (const row of rows) {
    const normalized = normalizeBlockedUserRow(row);
    if (!normalized) continue;
    items.push(await withAvatar(normalized));
  }
  const pageSize = Math.min(50, Math.max(1, limit));
  return {
    items,
    offset,
    hasMore: rows.length >= pageSize,
  };
}
