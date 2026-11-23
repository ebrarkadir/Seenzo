import { normalizeProfileRow, normalizeUsername } from './profileRules';

export const SOCIAL_SEARCH_PAGE_SIZE = 20;
export const SOCIAL_SEARCH_DEBOUNCE_MS = 350;

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
  };
}

export function canPublishProfile({ username, isPublic }) {
  if (!isPublic) {
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
