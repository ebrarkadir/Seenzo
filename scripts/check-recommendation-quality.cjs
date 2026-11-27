const fs = require('fs');
const path = require('path');

function loadModules(relativePaths, returned) {
  const code = relativePaths.map((relativePath) => {
    const file = path.join(__dirname, '..', relativePath);
    return fs.readFileSync(file, 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]+\};?\s*$/gm, '')
      .replace(/^export /gm, '');
  }).join('\n');
  return new Function(`${code}\nreturn { ${returned} };`)();
}

const api = loadModules(
  [
    'src/tracking/status.js',
    'src/tracking/preferenceProfile.js',
    'src/data/labels.js',
    'src/tracking/watchlistOrder.js',
    'src/tracking/watchlistSort.js',
    'src/tracking/watchlist.js',
    'src/tracking/discoverRecommendations.js',
  ],
  [
    'buildPreferenceProfile',
    'scoreCandidate',
    'rankCandidates',
    'WATCHLIST_SORT_FOR_YOU',
    'formatRecommendationReason',
    'recommendationReasonDescriptor',
    'buildDiscoverRecommendations',
    'mediaGenres',
    'genrePairKey',
    'effectiveGenreAffinity',
  ].join(', ')
);

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const t = (key, vars = {}) => {
  const map = {
    'catalog.genres.drama': 'Drama',
    'catalog.genres.crime': 'Crime',
    'catalog.genres.thriller': 'Thriller',
    'catalog.genres.fantasy': 'Fantasy',
    'catalog.genres.action': 'Action',
    'catalog.genres.adventure': 'Adventure',
    'catalog.genres.scienceFiction': 'Sci-Fi',
    'catalog.genres.comedy': 'Comedy',
    'discover.becauseYouLike': `Because you like ${vars.genre}`,
    'discover.becauseYouEnjoyCombo': `Because you enjoy ${vars.combo}`,
  };
  return map[key] || key;
};

// Typical Trakt-like genre fixtures (explicit — not scraped from production).
const shows = {
  'trakt-show-bb': {
    id: 'trakt-show-bb',
    traktId: '1',
    title: 'Breaking Bad',
    genres: ['crime', 'drama', 'thriller'],
  },
  'trakt-show-mob': {
    id: 'trakt-show-mob',
    traktId: '2',
    title: 'MobLand',
    genres: ['crime', 'drama'],
  },
  'trakt-show-rop': {
    id: 'trakt-show-rop',
    traktId: '3',
    title: 'The Rings of Power',
    genres: ['fantasy', 'action', 'adventure'],
  },
  'trakt-show-greys': {
    id: 'trakt-show-greys',
    title: 'Grey\'s Anatomy',
    genres: ['drama'],
  },
  'trakt-show-landman': {
    id: 'trakt-show-landman',
    title: 'Landman',
    genres: ['drama'],
  },
  'trakt-show-gilded': {
    id: 'trakt-show-gilded',
    title: 'The Gilded Age',
    genres: ['drama'],
  },
  'trakt-show-saul': {
    id: 'trakt-show-saul',
    title: 'Better Call Saul',
    genres: ['crime', 'drama'],
  },
  'trakt-show-ozark': {
    id: 'trakt-show-ozark',
    title: 'Ozark',
    genres: ['crime', 'drama', 'thriller'],
  },
  'trakt-show-narcos': {
    id: 'trakt-show-narcos',
    title: 'Narcos',
    genres: ['crime', 'drama'],
  },
};

const state = {
  shows: {
    'trakt-show-bb': { intent: 'watching', watchedEpisodeIds: [], rating: 10 },
    'trakt-show-mob': { intent: 'watching', watchedEpisodeIds: [], rating: 8 },
    'trakt-show-rop': { intent: 'watching', watchedEpisodeIds: [], rating: 5 },
  },
  showRatings: {},
};

const profile = api.buildPreferenceProfile(state, {
  mediaKind: 'show',
  resolveShow: (id) => shows[id] || null,
});

expect('fixture profile ready', profile.ready, true);
expect('breaking bad genres', api.mediaGenres(shows['trakt-show-bb']), ['crime', 'drama', 'thriller']);
expect('mobland genres', api.mediaGenres(shows['trakt-show-mob']), ['crime', 'drama']);
expect('rop genres no false crime', api.mediaGenres(shows['trakt-show-rop']).includes('crime'), false);
expect('crime affinity positive', profile.genreAffinity.crime > 0, true);
expect('drama affinity positive', profile.genreAffinity.drama > 0, true);
expect('fantasy affinity not strongly positive', (profile.genreAffinity.fantasy || 0) <= 0.2, true);
expect('crime|drama pair learned', (profile.pairAffinity['crime|drama'] || 0) > 0, true);

const scores = {
  greys: api.scoreCandidate(shows['trakt-show-greys'], profile),
  landman: api.scoreCandidate(shows['trakt-show-landman'], profile),
  gilded: api.scoreCandidate(shows['trakt-show-gilded'], profile),
  saul: api.scoreCandidate(shows['trakt-show-saul'], profile),
  ozark: api.scoreCandidate(shows['trakt-show-ozark'], profile),
  narcos: api.scoreCandidate(shows['trakt-show-narcos'], profile),
};

expect('Saul beats Grey\'s Anatomy', scores.saul > scores.greys, true);
expect('Ozark beats Landman', scores.ozark > scores.landman, true);
expect('Narcos beats Gilded Age', scores.narcos > scores.gilded, true);
expect(
  'crime dramas beat generic drama mean gap',
  Math.min(scores.saul, scores.ozark, scores.narcos) > Math.max(scores.greys, scores.landman, scores.gilded),
  true
);

const ranked = api.rankCandidates([
  shows['trakt-show-greys'],
  shows['trakt-show-landman'],
  shows['trakt-show-gilded'],
  shows['trakt-show-saul'],
  shows['trakt-show-ozark'],
  shows['trakt-show-narcos'],
], {
  profile,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.title,
  getMedia: (item) => item,
});
const top3 = ranked.slice(0, 3).map((item) => item.id);
expect('top3 are crime dramas', top3.every((id) => (
  id === 'trakt-show-saul' || id === 'trakt-show-ozark' || id === 'trakt-show-narcos'
)), true);
expect('generic dramas not in top3', top3.includes('trakt-show-greys') || top3.includes('trakt-show-gilded'), false);

const saulReason = api.formatRecommendationReason(t, shows['trakt-show-saul'], profile);
expect('why recommended uses crime drama combo', saulReason.includes('Crime') && saulReason.includes('Drama'), true);
const greysReason = api.formatRecommendationReason(t, shows['trakt-show-greys'], profile);
expect('generic drama reason is not a fake crime claim', !String(greysReason || '').toLowerCase().includes('crime'), true);

// Second movie fixture — Sci-Fi likes should beat pure Drama.
const movies = {
  'trakt-movie-1': { id: 'trakt-movie-1', title: 'Dune', genres: ['science-fiction', 'adventure'] },
  'trakt-movie-2': { id: 'trakt-movie-2', title: 'Arrival', genres: ['science-fiction', 'drama'] },
  'trakt-movie-3': { id: 'trakt-movie-3', title: 'Interstellar', genres: ['science-fiction', 'drama', 'adventure'] },
  'trakt-movie-rom': { id: 'trakt-movie-rom', title: 'The Notebook', genres: ['drama', 'romance'] },
  'trakt-movie-scifi': { id: 'trakt-movie-scifi', title: 'Ex Machina', genres: ['science-fiction', 'thriller'] },
};
const movieProfile = api.buildPreferenceProfile({
  movies: {
    'trakt-movie-1': { saved: true, watched: true, rating: 10 },
    'trakt-movie-2': { saved: true, watched: true, rating: 9 },
    'trakt-movie-3': { saved: true, watched: true, rating: 9 },
  },
}, {
  mediaKind: 'movie',
  resolveMovie: (id) => movies[id] || null,
});
expect(
  'movie scifi beats romance drama',
  api.scoreCandidate(movies['trakt-movie-scifi'], movieProfile)
    > api.scoreCandidate(movies['trakt-movie-rom'], movieProfile),
  true
);

const cold = api.buildPreferenceProfile({ shows: {} }, { mediaKind: 'show', resolveShow: () => null });
expect('cold start still not ready', cold.ready, false);

const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/catalog.js'), 'utf8');
expect('related shows endpoint wired', catalogSource.includes('/shows/') && catalogSource.includes('/related'), true);
expect('related movies endpoint wired', catalogSource.includes('/movies/') && catalogSource.includes('/related'), true);
expect('genre popular expansion wired', catalogSource.includes('genres: slug'), true);
expect('drama-only genre expansion skipped', catalogSource.includes("genre === 'drama'"), true);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}

console.log('Quality fixture affinities', {
  crime: profile.genreAffinity.crime,
  drama: profile.genreAffinity.drama,
  thriller: profile.genreAffinity.thriller,
  fantasy: profile.genreAffinity.fantasy,
  pairCrimeDrama: profile.pairAffinity['crime|drama'],
});
console.log('Quality fixture scores', scores);
console.log('Quality fixture top3', top3);
console.log(`Recommendation quality checks passed (${checks.length})`);
