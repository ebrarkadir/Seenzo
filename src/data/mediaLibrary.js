import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { getMovie as demoMovie, getShow as demoShow } from './catalog';

const STORAGE_KEY = 'seenzo.catalog.v1';
const shows = {};
const movies = {};
let revision = 0;
let persistTimer = null;
const listeners = new Set();

function emit() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ shows, movies })).catch(() => {});
  }, 200);
}

export function subscribeMedia(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMediaRevision() {
  return revision;
}

export function useMediaRevision() {
  return useSyncExternalStore(subscribeMedia, getMediaRevision, getMediaRevision);
}

export function resolveShow(id) {
  return demoShow(id) || shows[id] || null;
}

export function resolveMovie(id) {
  return demoMovie(id) || movies[id] || null;
}

function mergePreservedEpisodeOverviews(current, incoming) {
  if (!current?.seasons?.length || !incoming?.seasons?.length) {
    return incoming;
  }
  const overviewByKey = new Map();
  current.seasons.forEach((season) => {
    (season?.episodes || []).forEach((episode) => {
      const text = typeof episode?.overview === 'string' ? episode.overview.trim() : '';
      if (!text || typeof episode?.number !== 'number' || typeof season?.season !== 'number') {
        return;
      }
      overviewByKey.set(`${season.season}:${episode.number}`, text);
    });
  });
  if (!overviewByKey.size) {
    return incoming;
  }
  return {
    ...incoming,
    seasons: incoming.seasons.map((season) => ({
      ...season,
      episodes: (season?.episodes || []).map((episode) => {
        const key = `${season.season}:${episode.number}`;
        const preserved = overviewByKey.get(key);
        const incomingOverview = typeof episode?.overview === 'string' ? episode.overview.trim() : '';
        if (!preserved || incomingOverview) {
          return episode;
        }
        return { ...episode, overview: preserved };
      }),
    })),
  };
}

export function rememberShow(show) {
  if (!show?.id || demoShow(show.id)) {
    return show || null;
  }
  const current = shows[show.id];
  if (current?.hydrated && !show.hydrated) {
    return current;
  }
  const next = mergePreservedEpisodeOverviews(current, show);
  shows[show.id] = next;
  schedulePersist();
  emit();
  return next;
}

/** Patch a single episode overview without wiping the rest of the cached show. */
export function patchEpisodeOverview(showId, seasonNumber, episodeNumber, overview) {
  const id = String(showId || '');
  const season = Number(seasonNumber);
  const number = Number(episodeNumber);
  const text = typeof overview === 'string' ? overview.trim() : '';
  if (!id || demoShow(id) || !text || !Number.isInteger(season) || season < 0 || !Number.isInteger(number) || number <= 0) {
    return null;
  }
  const current = shows[id];
  if (!current?.seasons?.length) {
    return current || null;
  }
  let changed = false;
  const seasons = current.seasons.map((block) => {
    if (block.season !== season) {
      return block;
    }
    return {
      ...block,
      episodes: (block.episodes || []).map((episode) => {
        if (episode.number !== number) {
          return episode;
        }
        const existing = typeof episode.overview === 'string' ? episode.overview.trim() : '';
        if (existing) {
          return episode;
        }
        changed = true;
        return { ...episode, overview: text };
      }),
    };
  });
  if (!changed) {
    return current;
  }
  const next = { ...current, seasons };
  shows[id] = next;
  schedulePersist();
  emit();
  return next;
}

export function rememberMovie(movie) {
  if (!movie?.id || demoMovie(movie.id)) {
    return movie || null;
  }
  movies[movie.id] = movie;
  schedulePersist();
  emit();
  return movie;
}

export async function loadMediaLibrary() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = JSON.parse(stored);
    Object.assign(shows, parsed?.shows && typeof parsed.shows === 'object' ? parsed.shows : {});
    Object.assign(movies, parsed?.movies && typeof parsed.movies === 'object' ? parsed.movies : {});
    emit();
  } catch {
    // Keep the in-memory library empty if the cache cannot be read.
  }
}
