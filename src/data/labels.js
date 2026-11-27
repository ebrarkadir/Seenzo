import { normalizeGenre } from '../tracking/preferenceProfile';

/** Normalized genre key → i18n catalog key (display only; does not invent genres). */
const GENRE_I18N = {
  action: 'catalog.genres.action',
  adventure: 'catalog.genres.adventure',
  animation: 'catalog.genres.animation',
  anime: 'catalog.genres.anime',
  comedy: 'catalog.genres.comedy',
  crime: 'catalog.genres.crime',
  documentary: 'catalog.genres.documentary',
  drama: 'catalog.genres.drama',
  family: 'catalog.genres.family',
  fantasy: 'catalog.genres.fantasy',
  history: 'catalog.genres.history',
  holiday: 'catalog.genres.holiday',
  horror: 'catalog.genres.horror',
  music: 'catalog.genres.music',
  musical: 'catalog.genres.musical',
  mystery: 'catalog.genres.mystery',
  romance: 'catalog.genres.romance',
  sciencefiction: 'catalog.genres.scienceFiction',
  scifi: 'catalog.genres.scienceFiction',
  short: 'catalog.genres.short',
  superhero: 'catalog.genres.superhero',
  suspense: 'catalog.genres.suspense',
  thriller: 'catalog.genres.thriller',
  war: 'catalog.genres.war',
  western: 'catalog.genres.western',
};

function titleCaseWord(word) {
  if (!word) {
    return '';
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function humanizeGenreToken(value) {
  let raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('catalog.genres.')) {
    raw = raw.slice('catalog.genres.'.length);
  }
  raw = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_+/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return '';
  }
  return raw.split(' ').map(titleCaseWord).join(' ');
}

/** User-facing label for a Trakt genre string or demo `genreKey`. */
export function formatGenreLabel(t, value) {
  const key = normalizeGenre(value);
  if (!key) {
    return null;
  }
  const i18nKey = GENRE_I18N[key];
  if (i18nKey && typeof t === 'function') {
    const translated = t(i18nKey);
    if (translated && translated !== i18nKey) {
      return translated;
    }
  }
  const humanized = humanizeGenreToken(value);
  return humanized || null;
}

/**
 * Deduped user-facing genre labels from `genres[]` / demo `genreKey`.
 * Does not invent genres. Order follows source order.
 */
export function mediaGenreLabels(t, media, { limit = Infinity } = {}) {
  if (!media || typeof media !== 'object') {
    return [];
  }
  const max = Number.isFinite(limit) ? Math.max(0, limit) : Infinity;
  const seen = new Set();
  const labels = [];
  const push = (raw) => {
    const key = normalizeGenre(raw);
    if (!key || seen.has(key) || labels.length >= max) {
      return;
    }
    const label = formatGenreLabel(t, raw);
    if (!label) {
      return;
    }
    seen.add(key);
    labels.push(label);
  };
  if (Array.isArray(media.genres)) {
    media.genres.forEach(push);
  }
  if (media.genreKey) {
    push(media.genreKey);
  }
  return labels;
}

/**
 * Compact genre line for cards: up to `limit` labels joined with middots.
 * Returns null when no genre metadata exists (caller should hide the row).
 */
export function mediaGenreLine(t, media, { limit = 3, separator = ' · ' } = {}) {
  const labels = mediaGenreLabels(t, media, { limit });
  if (!labels.length) {
    return null;
  }
  return labels.join(separator);
}

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
