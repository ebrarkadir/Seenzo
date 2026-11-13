import { episodeId } from './catalog';

function span(showId, season, count) {
  return Array.from({ length: count }, (_, index) => episodeId(showId, season, index + 1));
}

export const demoTracking = {
  demoMode: true,
  shows: {
    'harbor-lights': {
      intent: 'watching',
      watchedEpisodeIds: span('harbor-lights', 1, 4),
      rating: 8,
    },
    northline: {
      intent: 'watching',
      watchedEpisodeIds: [...span('northline', 1, 6), episodeId('northline', 2, 1)],
      rating: 7,
    },
    'glass-archive': {
      intent: 'watching',
      watchedEpisodeIds: span('glass-archive', 1, 6),
      rating: 9,
    },
    'ember-court': {
      intent: 'watching',
      watchedEpisodeIds: span('ember-court', 1, 6),
      rating: 10,
    },
    kinfolk: {
      intent: 'dropped',
      watchedEpisodeIds: span('kinfolk', 1, 3),
      rating: 6,
    },
    'paper-saints': {
      intent: 'plan',
      watchedEpisodeIds: [],
      rating: null,
    },
    afterglow: {
      intent: 'plan',
      watchedEpisodeIds: [],
      rating: null,
    },
  },
  movies: {
    'violet-meridian': { saved: true, watched: false, rating: null },
    'low-orbit': { saved: true, watched: false, rating: null },
    'salt-silver': { saved: true, watched: false, rating: null },
    'golden-hour': { saved: true, watched: true, rating: 8 },
    'last-projectionist': { saved: true, watched: true, rating: 9 },
  },
};
