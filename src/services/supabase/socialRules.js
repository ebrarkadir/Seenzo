import { normalizeProfileRow, normalizeUsername } from './profileRules';

export const SOCIAL_SEARCH_PAGE_SIZE = 20;
export const SOCIAL_SEARCH_DEBOUNCE_MS = 350;
export const SOCIAL_LIST_PAGE_SIZE = 20;
export const SOCIAL_NOTIFICATIONS_PAGE_SIZE = 30;

export const RELATIONSHIP = {
  SELF: 'self',
  FOLLOW: 'follow',
  FOLLOWING: 'following',
  FOLLOW_BACK: 'follow_back',
  REQUESTED: 'requested',
  ACCEPT: 'accept',
};

export function emptyPublicStats() {
  return {
    moviesWatched: 0,
    episodesWatched: 0,
    showsTracked: 0,
  };
}

export function emptyFollowCounts() {
  return {
    followers: 0,
    following: 0,
  };
}

export function normalizePublicStats(row) {
  if (!row || typeof row !== 'object') {
    return emptyPublicStats();
  }
  return {
    moviesWatched: Math.max(0, Number(row.movies_watched ?? row.moviesWatched) || 0),
    episodesWatched: Math.max(0, Number(row.episodes_watched ?? row.episodesWatched) || 0),
    showsTracked: Math.max(0, Number(row.shows_tracked ?? row.showsTracked) || 0),
  };
}

export function normalizeFollowCounts(row) {
  if (!row || typeof row !== 'object') {
    return emptyFollowCounts();
  }
  return {
    followers: Math.max(0, Number(row.followers) || 0),
    following: Math.max(0, Number(row.following) || 0),
  };
}

export function normalizeDiscoveryProfile(row) {
  const profile = normalizeProfileRow(row);
  return {
    ...profile,
    isPublic: Boolean(row?.is_public ?? row?.isPublic ?? profile.isPublic),
    allowProfileDiscovery: Boolean(
      row?.allow_profile_discovery ?? row?.allowProfileDiscovery ?? profile.allowProfileDiscovery
    ),
  };
}

export function canPublishProfile({ username, isPublic }) {
  if (!isPublic) {
    return true;
  }
  const normalized = normalizeUsername(username);
  return Boolean(normalized && normalized.length >= 3);
}

export function canEnableDiscovery({ username, allowProfileDiscovery }) {
  if (!allowProfileDiscovery) {
    return true;
  }
  const normalized = normalizeUsername(username);
  return Boolean(normalized && normalized.length >= 3);
}

export function buildUsernameSearchPattern(query) {
  const normalized = normalizeUsername(query).replace(/[%_]/g, '');
  if (!normalized) {
    return null;
  }
  return `%${normalized}%`;
}

export function emptyRelationship() {
  return {
    isFollowing: false,
    followsYou: false,
    outgoingRequestId: null,
    incomingRequestId: null,
    targetIsPublic: false,
    targetIsDiscoverable: false,
  };
}

export function normalizeRelationship(row) {
  if (!row || typeof row !== 'object') {
    return emptyRelationship();
  }
  return {
    isFollowing: Boolean(row.is_following ?? row.isFollowing),
    followsYou: Boolean(row.follows_you ?? row.followsYou),
    outgoingRequestId: row.outgoing_request_id ?? row.outgoingRequestId ?? null,
    incomingRequestId: row.incoming_request_id ?? row.incomingRequestId ?? null,
    targetIsPublic: Boolean(row.target_is_public ?? row.targetIsPublic),
    targetIsDiscoverable: Boolean(row.target_is_discoverable ?? row.targetIsDiscoverable),
  };
}

export function resolveRelationshipAction(relationship, { isSelf = false } = {}) {
  if (isSelf) {
    return RELATIONSHIP.SELF;
  }
  const rel = relationship || emptyRelationship();
  if (rel.isFollowing) {
    return RELATIONSHIP.FOLLOWING;
  }
  if (rel.outgoingRequestId) {
    return RELATIONSHIP.REQUESTED;
  }
  if (rel.followsYou) {
    return RELATIONSHIP.FOLLOW_BACK;
  }
  return RELATIONSHIP.FOLLOW;
}

export function normalizeConnectionCard(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const userId = row.user_id || row.userId || null;
  if (!userId) {
    return null;
  }
  const relationship = {
    isFollowing: Boolean(row.is_following ?? row.isFollowing),
    followsYou: Boolean(row.follows_you ?? row.followsYou),
    outgoingRequestId: row.outgoing_request_id ?? row.outgoingRequestId ?? null,
    incomingRequestId: null,
    targetIsPublic: Boolean(row.is_public ?? row.isPublic),
    targetIsDiscoverable: Boolean(
      (row.is_public ?? row.isPublic)
      || (row.allow_profile_discovery ?? row.allowProfileDiscovery)
    ),
  };
  return {
    userId,
    username: normalizeUsername(row.username ?? ''),
    displayName: String(row.display_name ?? row.displayName ?? '').trim(),
    avatarPath: row.avatar_path ?? row.avatarPath ?? null,
    avatarUrl: row.avatarUrl ?? null,
    isPublic: Boolean(row.is_public ?? row.isPublic),
    allowProfileDiscovery: Boolean(row.allow_profile_discovery ?? row.allowProfileDiscovery),
    createdAt: row.created_at ?? row.createdAt ?? null,
    relationship,
    action: resolveRelationshipAction(relationship),
  };
}

export function normalizeNotificationRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const id = row.id || null;
  if (!id) {
    return null;
  }
  const actor = {
    userId: row.actor_user_id ?? row.actorUserId ?? null,
    username: normalizeUsername(row.actor_username ?? row.actorUsername ?? ''),
    displayName: String(row.actor_display_name ?? row.actorDisplayName ?? '').trim(),
    avatarPath: row.actor_avatar_path ?? row.actorAvatarPath ?? null,
    avatarUrl: row.avatarUrl ?? row.actorAvatarUrl ?? null,
    isPublic: Boolean(row.actor_is_public ?? row.actorIsPublic),
    allowProfileDiscovery: Boolean(
      row.actor_allow_profile_discovery ?? row.actorAllowProfileDiscovery
    ),
  };
  return {
    id,
    type: row.type || null,
    entityType: row.entity_type ?? row.entityType ?? null,
    entityId: row.entity_id ?? row.entityId ?? null,
    readAt: row.read_at ?? row.readAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    unread: !(row.read_at ?? row.readAt),
    actor,
  };
}

export function formatRelativeTime(iso, nowMs = Date.now()) {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (deltaSec < 60) {
    return 'just now';
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)}m`;
  }
  if (deltaSec < 86400) {
    return `${Math.floor(deltaSec / 3600)}h`;
  }
  if (deltaSec < 86400 * 7) {
    return `${Math.floor(deltaSec / 86400)}d`;
  }
  return new Date(iso).toLocaleDateString();
}

export function isSocialV2UnavailableError(error) {
  const message = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
  return /Could not find the function|PGRST202|404|schema cache|social_unavailable/i.test(message);
}
