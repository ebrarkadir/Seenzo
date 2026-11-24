export const REVIEW_MAX_LENGTH = 500;

export function normalizeReviewText(value) {
  if (value == null) {
    return '';
  }
  return String(value).replace(/\r\n/g, '\n');
}

export function clampReviewText(value) {
  const text = normalizeReviewText(value);
  if (text.length <= REVIEW_MAX_LENGTH) {
    return text;
  }
  return text.slice(0, REVIEW_MAX_LENGTH);
}

export function trimmedReviewText(value) {
  return clampReviewText(value).trim();
}

export function isValidReviewText(value) {
  const text = normalizeReviewText(value);
  return text.length <= REVIEW_MAX_LENGTH;
}

export function reviewPayloadFromInput({
  mediaType,
  mediaId,
  showMediaId = null,
  seasonNumber = null,
  episodeNumber = null,
  reviewText = '',
  containsSpoilers = false,
} = {}) {
  const type = String(mediaType || '');
  const id = String(mediaId || '').trim();
  if (!id || !['movie', 'show', 'episode'].includes(type)) {
    return null;
  }
  if (type === 'movie' && !/^trakt-movie-\d+$/.test(id)) {
    return null;
  }
  if (type === 'show' && !/^trakt-show-\d+$/.test(id)) {
    return null;
  }
  if (type === 'episode') {
    if (!/^trakt-episode-\d+$/.test(id)) {
      return null;
    }
    if (!showMediaId || !/^trakt-show-\d+$/.test(String(showMediaId))) {
      return null;
    }
    const season = Number(seasonNumber);
    const episode = Number(episodeNumber);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) {
      return null;
    }
  }

  const text = trimmedReviewText(reviewText);
  if (!text) {
    return {
      mediaType: type,
      mediaId: id,
      showMediaId: type === 'episode' ? String(showMediaId) : null,
    seasonNumber: type === 'episode' ? Number(seasonNumber) : null,
    episodeNumber: type === 'episode' ? Number(episodeNumber) : null,
    reviewText: '',
    containsSpoilers: false,
    empty: true,
  };
  }

  return {
    mediaType: type,
    mediaId: id,
    showMediaId: type === 'episode' ? String(showMediaId) : null,
    seasonNumber: type === 'episode' ? Number(seasonNumber) : null,
    episodeNumber: type === 'episode' ? Number(episodeNumber) : null,
    reviewText: text,
    containsSpoilers: Boolean(containsSpoilers),
    empty: false,
  };
}
