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

export function rememberShow(show) {
  if (!show?.id || demoShow(show.id)) {
    return show || null;
  }
  const current = shows[show.id];
  if (current?.hydrated && !show.hydrated) {
    return current;
  }
  shows[show.id] = show;
  schedulePersist();
  emit();
  return show;
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
