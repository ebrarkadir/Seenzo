import { getSupabase } from './client';
import { createSignedProfileUrl } from './profileMedia';
import {
  emptyFavorites,
  normalizeFavoritesList,
  normalizeProfileRow,
  normalizeUsername,
} from './profileRules';
import {
  SOCIAL_SEARCH_PAGE_SIZE,
  buildUsernameSearchPattern,
  emptyFollowCounts,
  emptyPublicStats,
  normalizeDiscoveryProfile,
  normalizeFollowCounts,
  normalizePublicStats,
} from './socialRules';

const PROFILE_PUBLIC_COLUMNS = 'user_id, display_name, username, bio, avatar_path, banner_path, is_public, updated_at';

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

async function requireUserId(supabase) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw markCoded('unauthenticated', error);
  }
  return data.user.id;
}

async function withPublicSignedUrls(profile) {
  const next = { ...profile };
  if (profile.avatarPath) {
    const signed = await createSignedProfileUrl(profile.avatarPath);
    next.avatarUrl = signed?.url || null;
  } else {
    next.avatarUrl = null;
  }
  if (profile.bannerPath) {
    const signed = await createSignedProfileUrl(profile.bannerPath);
    next.bannerUrl = signed?.url || null;
  } else {
    next.bannerUrl = null;
  }
  return next;
}

export async function searchPublicProfiles({ query, offset = 0, limit = SOCIAL_SEARCH_PAGE_SIZE } = {}) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  await requireUserId(supabase);
  const pattern = buildUsernameSearchPattern(query);
  if (!pattern) {
    return { items: [], offset: 0, hasMore: false };
  }
  const from = Math.max(0, Number(offset) || 0);
  const size = Math.min(50, Math.max(1, Number(limit) || SOCIAL_SEARCH_PAGE_SIZE));
  const to = from + size - 1;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_PUBLIC_COLUMNS)
    .eq('is_public', true)
    .not('username', 'is', null)
    .ilike('username', pattern)
    .order('username', { ascending: true })
    .range(from, to);
  if (error) {
    if (/is_public|schema cache|PGRST/i.test(`${error.message || ''} ${error.code || ''}`)) {
      throw markCoded('social_unavailable', error);
    }
    throw markCoded('search_failed', error);
  }
  const rows = data || [];
  const items = await Promise.all(
    rows.map(async (row) => withPublicSignedUrls(normalizeDiscoveryProfile(row)))
  );
  return {
    items,
    offset: from,
    hasMore: rows.length === size,
  };
}

export async function fetchPublicProfileByUsername(username) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const viewerId = await requireUserId(supabase);
  const normalized = normalizeUsername(username);
  if (!normalized) {
    throw markCoded('invalid_username');
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_PUBLIC_COLUMNS)
    .eq('is_public', true)
    .ilike('username', normalized)
    .maybeSingle();
  if (error) {
    if (/is_public|schema cache|PGRST/i.test(`${error.message || ''} ${error.code || ''}`)) {
      throw markCoded('social_unavailable', error);
    }
    throw markCoded('profile_load_failed', error);
  }
  if (!data) {
    throw markCoded('profile_not_found');
  }
  const profile = await withPublicSignedUrls(normalizeDiscoveryProfile(data));
  const [favorites, stats, followCounts, isFollowing] = await Promise.all([
    fetchPublicFavorites(profile.userId),
    fetchPublicStats(profile.userId),
    fetchFollowCounts(profile.userId),
    fetchIsFollowing(profile.userId),
  ]);
  return {
    profile,
    favorites,
    stats,
    followCounts,
    isFollowing,
    isSelf: viewerId === profile.userId,
  };
}

async function fetchPublicFavorites(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profile_favorites')
    .select('media_type, media_id, position')
    .eq('user_id', userId)
    .order('position', { ascending: true });
  if (error) {
    return emptyFavorites();
  }
  return {
    shows: normalizeFavoritesList(data, 'show'),
    movies: normalizeFavoritesList(data, 'movie'),
  };
}

export async function fetchPublicStats(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_public_profile_stats', {
    p_user_id: userId,
  });
  if (error) {
    if (/profile_not_public/i.test(error.message || '')) {
      throw markCoded('profile_not_public', error);
    }
    return emptyPublicStats();
  }
  const row = Array.isArray(data) ? data[0] : data;
  return normalizePublicStats(row);
}

export async function fetchFollowCounts(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_public_follow_counts', {
    p_user_id: userId,
  });
  if (error) {
    return emptyFollowCounts();
  }
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeFollowCounts(row);
}

export async function fetchIsFollowing(targetUserId) {
  const supabase = getSupabase();
  const viewerId = await requireUserId(supabase);
  if (viewerId === targetUserId) {
    return false;
  }
  const { data, error } = await supabase
    .from('profile_follows')
    .select('following_id')
    .eq('follower_id', viewerId)
    .eq('following_id', targetUserId)
    .maybeSingle();
  if (error) {
    return false;
  }
  return Boolean(data);
}

export async function followUser(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const viewerId = await requireUserId(supabase);
  if (!targetUserId || viewerId === targetUserId) {
    throw markCoded('invalid_follow');
  }
  const { error } = await supabase
    .from('profile_follows')
    .upsert(
      { follower_id: viewerId, following_id: targetUserId },
      { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
    );
  if (error) {
    const message = `${error.message || ''} ${error.details || ''}`;
    if (/profile_follows_no_self|violates check/i.test(message)) {
      throw markCoded('invalid_follow', error);
    }
    if (/row-level security|42501/i.test(message)) {
      throw markCoded('profile_not_public', error);
    }
    if (/duplicate|unique/i.test(message)) {
      return true;
    }
    throw markCoded('follow_failed', error);
  }
  return true;
}

export async function unfollowUser(targetUserId) {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const viewerId = await requireUserId(supabase);
  if (!targetUserId || viewerId === targetUserId) {
    throw markCoded('invalid_follow');
  }
  const { error } = await supabase
    .from('profile_follows')
    .delete()
    .eq('follower_id', viewerId)
    .eq('following_id', targetUserId);
  if (error) {
    throw markCoded('unfollow_failed', error);
  }
  return true;
}

export function normalizeOwnProfileWithVisibility(row) {
  return {
    ...normalizeProfileRow(row),
    isPublic: Boolean(row?.is_public ?? row?.isPublic),
  };
}
