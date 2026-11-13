export function mediaTitle(t, item) {
  if (item?.title) {
    return item.title;
  }
  if (item?.titleKey) {
    return t(item.titleKey);
  }
  return '';
}

export function mediaSynopsis(t, item) {
  if (item?.overview) {
    return item.overview;
  }
  if (item?.synopsisKey) {
    return t(item.synopsisKey);
  }
  return '';
}

export function episodeTitle(t, episode) {
  if (episode?.title) {
    return episode.title;
  }
  if (episode?.titleKey) {
    return t(episode.titleKey);
  }
  return '';
}
