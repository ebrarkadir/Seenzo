import { sortItemsByWatchlistOrder, uniqueOrderIds } from './watchlistOrder';

export const MY_LIST_SORT_MY_ORDER = 'myOrder';
export const MY_LIST_SORT_OLDEST_ADDED = 'oldestAdded';
export const MY_LIST_SORT_NEWEST_ADDED = 'newestAdded';
export const MY_LIST_SORT_HIGHEST_RATED = 'highestRated';
export const MY_LIST_SORT_LOWEST_RATED = 'lowestRated';
export const MY_LIST_SORT_TITLE_ASC = 'titleAsc';
export const MY_LIST_SORT_TITLE_DESC = 'titleDesc';

export const MY_LIST_SORT_OPTIONS = [
  MY_LIST_SORT_MY_ORDER,
  MY_LIST_SORT_OLDEST_ADDED,
  MY_LIST_SORT_NEWEST_ADDED,
  MY_LIST_SORT_HIGHEST_RATED,
  MY_LIST_SORT_LOWEST_RATED,
  MY_LIST_SORT_TITLE_ASC,
  MY_LIST_SORT_TITLE_DESC,
];

export function normalizeWatchlistAddedAt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

export function nowWatchlistAddedAt(now = new Date()) {
  return now.toISOString();
}

/** Trakt community rating only — never personal entry.rating. */
export function communityRatingValue(media) {
  const value = media?.communityRating;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function compareTitleThenId(left, right, getTitle, getId) {
  const byTitle = String(getTitle(left) || '').localeCompare(String(getTitle(right) || ''));
  if (byTitle) {
    return byTitle;
  }
  return String(getId(left) || '').localeCompare(String(getId(right) || ''));
}

/**
 * View-only sorting for My List. Does not mutate items or My Order arrays.
 */
export function sortWatchlistItems(items, {
  mode = MY_LIST_SORT_MY_ORDER,
  order = [],
  getId = (item) => item?.id,
  getTitle = (item) => item?.title || '',
  getMedia = (item) => item?.movie || item?.show || item?.media || item,
  getAddedAt = (item) => item?.entry?.watchlistAddedAt ?? item?.watchlistAddedAt ?? null,
} = {}) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (mode === MY_LIST_SORT_MY_ORDER) {
    return sortItemsByWatchlistOrder(list, uniqueOrderIds(order), getId);
  }

  if (mode === MY_LIST_SORT_TITLE_ASC) {
    return list.sort((left, right) => compareTitleThenId(left, right, getTitle, getId));
  }
  if (mode === MY_LIST_SORT_TITLE_DESC) {
    return list.sort((left, right) => {
      const byTitle = String(getTitle(right) || '').localeCompare(String(getTitle(left) || ''));
      if (byTitle) {
        return byTitle;
      }
      return String(getId(left) || '').localeCompare(String(getId(right) || ''));
    });
  }

  if (mode === MY_LIST_SORT_OLDEST_ADDED || mode === MY_LIST_SORT_NEWEST_ADDED) {
    const newestFirst = mode === MY_LIST_SORT_NEWEST_ADDED;
    return list.sort((left, right) => {
      const leftAt = normalizeWatchlistAddedAt(getAddedAt(left));
      const rightAt = normalizeWatchlistAddedAt(getAddedAt(right));
      const leftMs = leftAt ? Date.parse(leftAt) : null;
      const rightMs = rightAt ? Date.parse(rightAt) : null;
      if (leftMs == null && rightMs == null) {
        return compareTitleThenId(left, right, getTitle, getId);
      }
      if (leftMs == null) {
        return 1;
      }
      if (rightMs == null) {
        return -1;
      }
      if (leftMs !== rightMs) {
        return newestFirst ? rightMs - leftMs : leftMs - rightMs;
      }
      return compareTitleThenId(left, right, getTitle, getId);
    });
  }

  if (mode === MY_LIST_SORT_HIGHEST_RATED || mode === MY_LIST_SORT_LOWEST_RATED) {
    const highestFirst = mode === MY_LIST_SORT_HIGHEST_RATED;
    return list.sort((left, right) => {
      const leftRating = communityRatingValue(getMedia(left));
      const rightRating = communityRatingValue(getMedia(right));
      if (leftRating == null && rightRating == null) {
        return compareTitleThenId(left, right, getTitle, getId);
      }
      if (leftRating == null) {
        return 1;
      }
      if (rightRating == null) {
        return -1;
      }
      if (leftRating !== rightRating) {
        return highestFirst ? rightRating - leftRating : leftRating - rightRating;
      }
      return compareTitleThenId(left, right, getTitle, getId);
    });
  }

  return sortItemsByWatchlistOrder(list, uniqueOrderIds(order), getId);
}
