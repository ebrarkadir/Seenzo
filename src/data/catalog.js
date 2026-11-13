function episodeId(showId, season, number) {
  return `${showId}-s${season}e${number}`;
}

function daysFromToday(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function weekly(showKey, showId, season, start, count, runtime = 46) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: episodeId(showId, season, number),
      season,
      number,
      titleKey: `catalog.ep.${showKey}.s${season}e${number}`,
      runtime,
      airDate: addDays(start, index * 7),
    };
  });
}

function art(id) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&h=960&q=80`;
}

export const shows = [
  {
    id: 'harbor-lights',
    titleKey: 'catalog.shows.harborLights',
    synopsisKey: 'catalog.synopsis.harborLights',
    poster: art('photo-1489599849927-2ee91cede3ba'),
    releaseStatus: 'ongoing',
    seasons: [
      { season: 1, episodes: weekly('harborLights', 'harbor-lights', 1, daysFromToday(-35), 8, 48) },
    ],
  },
  {
    id: 'northline',
    titleKey: 'catalog.shows.northline',
    synopsisKey: 'catalog.synopsis.northline',
    poster: art('photo-1506905925346-21bda4d32df4'),
    releaseStatus: 'ongoing',
    seasons: [
      { season: 1, episodes: weekly('northline', 'northline', 1, '2025-01-10', 6, 50) },
      { season: 2, episodes: weekly('northline', 'northline', 2, daysFromToday(-21), 6, 50) },
    ],
  },
  {
    id: 'glass-archive',
    titleKey: 'catalog.shows.glassArchive',
    synopsisKey: 'catalog.synopsis.glassArchive',
    poster: art('photo-1440404653325-ab127d49abc1'),
    releaseStatus: 'returning',
    seasons: [
      { season: 1, episodes: weekly('glassArchive', 'glass-archive', 1, '2025-04-04', 6, 44) },
      { season: 2, episodes: weekly('glassArchive', 'glass-archive', 2, daysFromToday(28), 1, 52) },
    ],
  },
  {
    id: 'ember-court',
    titleKey: 'catalog.shows.emberCourt',
    synopsisKey: 'catalog.synopsis.emberCourt',
    poster: art('photo-1514565131-fce0801e5785'),
    releaseStatus: 'ended',
    seasons: [
      { season: 1, episodes: weekly('emberCourt', 'ember-court', 1, '2023-02-03', 6, 54) },
    ],
  },
  {
    id: 'kinfolk',
    titleKey: 'catalog.shows.kinfolk',
    synopsisKey: 'catalog.synopsis.kinfolk',
    poster: art('photo-1470071459604-3b5ec3a7fe05'),
    releaseStatus: 'ongoing',
    seasons: [{ season: 1, episodes: weekly('kinfolk', 'kinfolk', 1, '2024-05-03', 8, 42) }],
  },
  {
    id: 'paper-saints',
    titleKey: 'catalog.shows.paperSaints',
    synopsisKey: 'catalog.synopsis.paperSaints',
    poster: art('photo-1469474968028-56623f02e42e'),
    releaseStatus: 'ongoing',
    seasons: [
      { season: 1, episodes: weekly('paperSaints', 'paper-saints', 1, '2026-08-07', 6, 43) },
    ],
  },
  {
    id: 'afterglow',
    titleKey: 'catalog.shows.afterglow',
    synopsisKey: 'catalog.synopsis.afterglow',
    poster: art('photo-1419242902214-272b3f66ee7a'),
    releaseStatus: 'ongoing',
    seasons: [{ season: 1, episodes: weekly('afterglow', 'afterglow', 1, '2026-09-04', 6, 41) }],
  },
  {
    id: 'neon-district',
    titleKey: 'catalog.shows.neonDistrict',
    synopsisKey: 'catalog.synopsis.neonDistrict',
    poster: art('photo-1518676590629-3dcbd9c5a5c9'),
    releaseStatus: 'ongoing',
    seasons: [
      { season: 1, episodes: weekly('neonDistrict', 'neon-district', 1, '2025-03-07', 6, 45) },
    ],
  },
  {
    id: 'wren',
    titleKey: 'catalog.shows.wren',
    synopsisKey: 'catalog.synopsis.wren',
    poster: art('photo-1478720568477-152d9b164e26'),
    releaseStatus: 'ended',
    seasons: [{ season: 1, episodes: weekly('wren', 'wren', 1, '2024-11-01', 6, 39) }],
  },
  {
    id: 'midnight-census',
    titleKey: 'catalog.shows.midnightCensus',
    synopsisKey: 'catalog.synopsis.midnightCensus',
    poster: art('photo-1536440136628-849c177e76a1'),
    releaseStatus: 'ongoing',
    seasons: [
      { season: 1, episodes: weekly('midnightCensus', 'midnight-census', 1, '2025-06-06', 6, 47) },
    ],
  },
];

export const movies = [
  {
    id: 'violet-meridian',
    titleKey: 'catalog.movies.violetMeridian',
    synopsisKey: 'catalog.synopsis.violetMeridian',
    year: 2024,
    genreKey: 'catalog.genres.drama',
    poster: art('photo-1519681393784-d120267933ba'),
  },
  {
    id: 'low-orbit',
    titleKey: 'catalog.movies.lowOrbit',
    synopsisKey: 'catalog.synopsis.lowOrbit',
    year: 2025,
    genreKey: 'catalog.genres.scienceFiction',
    poster: art('photo-1451187580459-43490279c0fa'),
  },
  {
    id: 'salt-silver',
    titleKey: 'catalog.movies.saltSilver',
    synopsisKey: 'catalog.synopsis.saltSilver',
    year: 2023,
    genreKey: 'catalog.genres.thriller',
    poster: art('photo-1500530855697-b586d89ba3ee'),
  },
  {
    id: 'golden-hour',
    titleKey: 'catalog.movies.goldenHour',
    synopsisKey: 'catalog.synopsis.goldenHour',
    year: 2022,
    genreKey: 'catalog.genres.romance',
    poster: art('photo-1574267432553-4b4628081c31'),
  },
  {
    id: 'last-projectionist',
    titleKey: 'catalog.movies.lastProjectionist',
    synopsisKey: 'catalog.synopsis.lastProjectionist',
    year: 2021,
    genreKey: 'catalog.genres.drama',
    poster: art('photo-1485846234645-a62644f84728'),
  },
  {
    id: 'river-of-static',
    titleKey: 'catalog.movies.riverOfStatic',
    synopsisKey: 'catalog.synopsis.riverOfStatic',
    year: 2024,
    genreKey: 'catalog.genres.mystery',
    poster: art('photo-1444703686981-a3abbc4d4fe3'),
  },
  {
    id: 'winter-signal',
    titleKey: 'catalog.movies.winterSignal',
    synopsisKey: 'catalog.synopsis.winterSignal',
    year: 2020,
    genreKey: 'catalog.genres.adventure',
    poster: art('photo-1524985069026-dd778a71c7b4'),
  },
];

export function getShow(id) {
  return shows.find((show) => show.id === id) || null;
}

export function getMovie(id) {
  return movies.find((movie) => movie.id === id) || null;
}

export { episodeId };
