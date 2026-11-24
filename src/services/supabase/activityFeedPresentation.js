export function describeActivityAction(t, item) {
  const type = item?.activityType;
  if (type === 'movie_watched') {
    return t('social.activity.actions.movieWatched');
  }
  if (type === 'episode_watched') {
    return t('social.activity.actions.episodeWatched');
  }
  if (type === 'movie_rated') {
    return t('social.activity.actions.movieRated');
  }
  if (type === 'show_rated') {
    return t('social.activity.actions.showRated');
  }
  if (type === 'episode_rated') {
    return t('social.activity.actions.episodeRated');
  }
  return t('social.activity.actions.generic');
}

export function formatActivityRating(rating) {
  if (rating == null || rating === '') {
    return null;
  }
  const value = Number(rating);
  if (!Number.isFinite(value)) {
    return null;
  }
  const label = Number.isInteger(value) ? String(value) : String(value);
  return `${label}/10`;
}
