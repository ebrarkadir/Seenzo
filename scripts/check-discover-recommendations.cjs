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
    'buildDiscoverRecommendations',
    'formatRecommendationReason',
    'recommendationReasonKey',
    'isMovieExcludedFromDiscover',
    'isShowExcludedFromDiscover',
    'formatGenreLabel',
    'mediaGenreLine',
    'mediaGenreLabels',
    'DISCOVER_RECOMMEND_RAIL_LIMIT',
    'DISCOVER_RECOMMEND_SEE_ALL_LIMIT',
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
    'catalog.genres.scienceFiction': 'Sci-Fi',
    'catalog.genres.thriller': 'Thriller',
    'catalog.genres.action': 'Action',
    'catalog.genres.comedy': 'Comedy',
    'discover.becauseYouLike': `Because you like ${vars.genre}`,
  };
  return map[key] || key;
};

const catalog = {
  'trakt-movie-1': { id: 'trakt-movie-1', title: 'Alpha Sci', genres: ['science-fiction', 'thriller'] },
  'trakt-movie-2': { id: 'trakt-movie-2', title: 'Beta Drama', genres: ['drama'] },
  'trakt-movie-3': { id: 'trakt-movie-3', title: 'Gamma Action', genres: ['action'] },
  'trakt-movie-4': { id: 'trakt-movie-4', title: 'Delta Comedy', genres: ['comedy'] },
  'trakt-movie-5': { id: 'trakt-movie-5', title: 'Epsilon Sci', genres: ['science-fiction'] },
  'trakt-movie-6': { id: 'trakt-movie-6', title: 'Zeta Missing' },
  'trakt-show-1': { id: 'trakt-show-1', title: 'Show Sci', genres: ['science-fiction'] },
  'trakt-show-2': { id: 'trakt-show-2', title: 'Show Drama', genres: ['drama'] },
  'trakt-show-3': {
    id: 'trakt-show-3',
    title: 'Show Done',
    genres: ['drama'],
    seasons: [{ season: 1, episodes: [{ id: 'trakt-episode-1', season: 1, number: 1, airDate: '2020-01-01' }] }],
  },
};

const movieState = {
  movies: {
    'trakt-movie-1': { saved: true, watched: true, rating: 9 },
    'trakt-movie-2': { saved: true, watched: true, rating: 8 },
    'trakt-movie-3': { saved: true, watched: true, rating: 3 },
    'trakt-movie-4': { saved: true, watched: true, rating: 9 },
  },
};

const movieProfile = api.buildPreferenceProfile(movieState, {
  mediaKind: 'movie',
  resolveMovie: (id) => catalog[id] || null,
});
expect('movie profile ready with ratings', movieProfile.ready, true);
expect('movie sci affinity positive', movieProfile.genreAffinity.sciencefiction > 0, true);
expect('movie action affinity negative', movieProfile.genreAffinity.action < 0, true);

const showState = {
  shows: {
    'trakt-show-1': { intent: 'watching', watchedEpisodeIds: [], rating: 9 },
    'trakt-show-2': { intent: 'watching', watchedEpisodeIds: [], rating: 8 },
    'trakt-show-3': { intent: 'watching', watchedEpisodeIds: [], rating: 2 },
  },
  showRatings: {},
};
const showProfile = api.buildPreferenceProfile(showState, {
  mediaKind: 'show',
  resolveShow: (id) => catalog[id] || null,
});
expect('show profile ready', showProfile.ready, true);
expect('profiles do not share affinity maps', movieProfile.genreAffinity === showProfile.genreAffinity, false);
expect('movie comedy not forced onto show profile', showProfile.genreAffinity.comedy == null, true);

const candidates = [
  catalog['trakt-movie-5'],
  catalog['trakt-movie-3'],
  catalog['trakt-movie-6'],
  catalog['trakt-movie-1'],
];
const ranked = api.buildDiscoverRecommendations(candidates, {
  profile: movieProfile,
  mediaKind: 'movie',
  moviesState: movieState.movies,
  t,
});
expect('watched movie excluded', ranked.items.every((row) => row.id !== 'trakt-movie-1'), true);
expect('sci-fi ranks above low action', ranked.items[0].id, 'trakt-movie-5');
expect('missing genre still safe in list or omitted without crash', Array.isArray(ranked.items), true);
expect('reason only for positive affinity', ranked.items.find((row) => row.id === 'trakt-movie-5')?.reasonGenre, 'sciencefiction');
expect(
  'formatted reason',
  api.formatRecommendationReason(t, catalog['trakt-movie-5'], movieProfile),
  'Because you like Sci-Fi'
);
expect(
  'no fake reason for weak/negative',
  api.formatRecommendationReason(t, catalog['trakt-movie-3'], movieProfile) == null,
  true
);

const cold = api.buildDiscoverRecommendations(candidates, {
  profile: api.buildPreferenceProfile({ movies: {} }, { mediaKind: 'movie', resolveMovie: () => null }),
  mediaKind: 'movie',
  moviesState: {},
  t,
});
expect('cold start empty personalized list', cold.ready, false);
expect('cold start items empty', cold.items, []);

const completedShow = {
  ...catalog['trakt-show-3'],
};
const showCandidates = [catalog['trakt-show-1'], completedShow, catalog['trakt-show-2']];
const showRecs = api.buildDiscoverRecommendations(showCandidates, {
  profile: showProfile,
  mediaKind: 'show',
  showsState: {
    'trakt-show-3': {
      intent: 'watching',
      watchedEpisodeIds: ['trakt-episode-1'],
      rating: 2,
    },
  },
  resolveShow: (id) => catalog[id] || null,
  t,
});
expect('caught-up/completed show excluded', showRecs.items.every((row) => row.id !== 'trakt-show-3'), true);

expect('genre labels unlimited for detail', api.mediaGenreLabels(t, {
  genres: ['science-fiction', 'thriller', 'drama', 'action'],
}).length, 4);
expect('card line caps at 3', api.mediaGenreLine(t, {
  genres: ['science-fiction', 'thriller', 'drama', 'action'],
}), 'Sci-Fi · Thriller · Drama');

const discoverSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/discover.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/catalog.js'), 'utf8');
const showCard = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/ShowCard.js'), 'utf8');
const showDetail = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');
const movieDetail = fs.readFileSync(path.join(__dirname, '..', 'src/app/movie/[id].js'), 'utf8');
const tvTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/index.js'), 'utf8');
const sortSelect = fs.existsSync(path.join(__dirname, '..', 'src/components/tracking/WatchlistSortSelect.js'));

expect('rail limit is compact', api.DISCOVER_RECOMMEND_RAIL_LIMIT, 8);
expect('see-all limit is unbounded', Number.isFinite(api.DISCOVER_RECOMMEND_SEE_ALL_LIMIT), false);

const manyCandidates = Array.from({ length: 20 }, (_, index) => ({
  id: `trakt-movie-${100 + index}`,
  title: `Cand ${String(index).padStart(2, '0')}`,
  genres: index % 2 === 0 ? ['science-fiction'] : ['drama'],
}));
const railOnly = api.buildDiscoverRecommendations(manyCandidates, {
  profile: movieProfile,
  mediaKind: 'movie',
  moviesState: {},
  limit: api.DISCOVER_RECOMMEND_RAIL_LIMIT,
  t,
});
const seeAll = api.buildDiscoverRecommendations(manyCandidates, {
  profile: movieProfile,
  mediaKind: 'movie',
  moviesState: {},
  limit: api.DISCOVER_RECOMMEND_SEE_ALL_LIMIT,
  t,
});
expect('rail truncates', railOnly.items.length, 8);
expect('see-all exceeds rail', seeAll.items.length > railOnly.items.length, true);
expect('see-all total tracked', seeAll.total >= seeAll.items.length, true);
expect('see-all preserves score order prefix', seeAll.items.slice(0, 8).map((row) => row.id), railOnly.items.map((row) => row.id));

expect('discover uses shared preference profile', discoverSource.includes('buildPreferenceProfile'), true);
expect('discover loads recommendation pools', discoverSource.includes('recommendationMoviePool') && discoverSource.includes('recommendationShowPool'), true);
expect('discover movies rail gated', discoverSource.includes('isMovieFilter ?') && discoverSource.includes('recommendedMovies'), true);
expect('discover shows rail gated', discoverSource.includes('recommendedShows') && discoverSource.includes("openSeeAll('show')"), true);
expect('discover see all route', discoverSource.includes('/discover/recommendations'), true);
expect('see all screen exists', fs.existsSync(path.join(__dirname, '..', 'src/app/discover/recommendations.js')), true);
const seeAllSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/discover/recommendations.js'), 'utf8');
expect('see all uses expanded pool', seeAllSource.includes('trendingPages: 3') && seeAllSource.includes('DISCOVER_RECOMMEND_SEE_ALL_LIMIT'), true);
expect('see all uses same builder', seeAllSource.includes('buildDiscoverRecommendations'), true);
expect('popular endpoints present', catalogSource.includes('/movies/popular') && catalogSource.includes('/shows/popular'), true);
expect('show card genres', showCard.includes('mediaGenreLine'), true);
expect('show detail genres', showDetail.includes('mediaGenreLabels'), true);
expect('movie detail genres', movieDetail.includes('mediaGenreLabels'), true);
expect('tv plan genreLine', tvTab.includes('genreLine={mediaGenreLine(t, item.show)}'), true);
expect('sort dropdown already present', sortSelect, true);
expect('rail has see all control', fs.readFileSync(path.join(__dirname, '..', 'src/components/discover/DiscoverRecommendRail.js'), 'utf8').includes('showSeeAll'), true);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}
console.log(`Discover recommendation checks passed (${checks.length})`);
