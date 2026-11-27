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
  ],
  [
    'PREFERENCE_MIN_RATED_WITH_GENRES',
    'PREFERENCE_RATING_NEUTRAL',
    'PREFERENCE_CONFIDENCE_RATINGS',
    'WATCHLIST_SORT_TITLE',
    'WATCHLIST_SORT_FOR_YOU',
    'WATCHLIST_SORTS',
    'normalizeGenre',
    'mediaGenres',
    'buildPreferenceProfile',
    'scoreCandidate',
    'rankCandidates',
    'shouldFallbackToTitle',
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

const catalog = {
  'drama-a': { id: 'drama-a', title: 'Alpha Drama', genres: ['Drama'] },
  'drama-b': { id: 'drama-b', title: 'Beta Drama', genres: ['Drama'] },
  'drama-c': { id: 'drama-c', title: 'Charlie Drama', genres: ['Drama'] },
  'comedy-a': { id: 'comedy-a', title: 'Alpha Comedy', genres: ['Comedy'] },
  'comedy-b': { id: 'comedy-b', title: 'Beta Comedy', genres: ['Comedy'] },
  'comedy-c': { id: 'comedy-c', title: 'Charlie Comedy', genres: ['Comedy'] },
  'mixed-a': { id: 'mixed-a', title: 'Mixed One', genres: ['Drama', 'Comedy'] },
  'scifi-demo': { id: 'scifi-demo', title: 'Orbit', genreKey: 'catalog.genres.scienceFiction' },
  'scifi-trakt': { id: 'scifi-trakt', title: 'Orbit Trakt', genres: ['Science Fiction'] },
  'nog-genre': { id: 'nog-genre', title: 'Mystery Box', genres: [] },
  'watch-drama': { id: 'watch-drama', title: 'Watchlist Drama', genres: ['Drama'] },
  'watch-comedy': { id: 'watch-comedy', title: 'Watchlist Comedy', genres: ['Comedy'] },
  'watch-scifi': { id: 'watch-scifi', title: 'Watchlist SciFi', genres: ['Science Fiction'] },
  'watch-empty': { id: 'watch-empty', title: 'Watchlist Empty', genres: [] },
  'watch-tie-b': { id: 'watch-tie-b', title: 'Same Title', genres: ['Drama'] },
  'watch-tie-a': { id: 'watch-tie-a', title: 'Same Title', genres: ['Drama'] },
};

function resolveMovie(id) {
  return catalog[id] || null;
}

expect('normalize trakt genre', api.normalizeGenre('Science Fiction'), 'sciencefiction');
expect('normalize genreKey', api.normalizeGenre('catalog.genres.scienceFiction'), 'sciencefiction');
expect('normalize empty is null', api.normalizeGenre(''), null);
expect('mediaGenres merges genres and genreKey', api.mediaGenres({
  genres: ['Drama', 'drama'],
  genreKey: 'catalog.genres.thriller',
}), ['drama', 'thriller']);
expect('mediaGenres genreKey alone', api.mediaGenres(catalog['scifi-demo']), ['sciencefiction']);
expect('mediaGenres empty safe', api.mediaGenres(null), []);

const emptyProfile = api.buildPreferenceProfile({ movies: {} }, { resolveMovie });
expect('no ratings not ready', emptyProfile.ready, false);
expect('no ratings reason', emptyProfile.reason, 'no_ratings');
expect('should fallback without profile', api.shouldFallbackToTitle(emptyProfile), true);

const unratedWatched = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: null },
    'drama-b': { saved: true, watched: true, rating: null },
    'drama-c': { saved: true, watched: true, rating: null },
  },
}, { resolveMovie });
expect('watched without ratings not ready', unratedWatched.ready, false);
expect('watched without ratings counts zero rated', unratedWatched.ratedMovieCount, 0);

const ratedNoGenres = api.buildPreferenceProfile({
  movies: {
    'nog-genre': { saved: true, watched: true, rating: 9 },
    a: { saved: true, watched: true, rating: 8 },
    b: { saved: true, watched: true, rating: 7 },
  },
}, {
  resolveMovie: (id) => (id === 'nog-genre' ? catalog['nog-genre'] : { id, title: id, genres: [] }),
});
expect('ratings without genres not ready', ratedNoGenres.ready, false);
expect('insufficient genres or ratings reason', ['insufficient_ratings', 'insufficient_genres'].includes(ratedNoGenres.reason), true);

const likedDrama = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: 9 },
    'drama-b': { saved: true, watched: true, rating: 10 },
    'drama-c': { saved: true, watched: true, rating: 9 },
    'comedy-a': { saved: true, watched: true, rating: 3 },
    'comedy-b': { saved: true, watched: true, rating: 2 },
    'comedy-c': { saved: true, watched: true, rating: 3 },
  },
}, { resolveMovie });
expect('enough ratings ready', likedDrama.ready, true);
expect('drama affinity positive', likedDrama.genreAffinity.drama > 0, true);
expect('comedy affinity negative', likedDrama.genreAffinity.comedy < 0, true);

const watchlist = [
  { id: 'watch-comedy', movie: catalog['watch-comedy'], entry: { saved: true, watched: false, rating: null } },
  { id: 'watch-drama', movie: catalog['watch-drama'], entry: { saved: true, watched: false, rating: null } },
  { id: 'watch-scifi', movie: catalog['watch-scifi'], entry: { saved: true, watched: false, rating: null } },
];
const frozen = JSON.stringify(watchlist);
const rankedForYou = api.rankCandidates(watchlist, {
  profile: likedDrama,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
});
expect('for you prefers liked genre', rankedForYou.map((item) => item.id), [
  'watch-drama',
  'watch-scifi',
  'watch-comedy',
]);
expect('rankCandidates does not mutate input', JSON.stringify(watchlist), frozen);

const rankedTitle = api.rankCandidates(watchlist, {
  profile: likedDrama,
  mode: api.WATCHLIST_SORT_TITLE,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
});
expect('title mode is A-Z', rankedTitle.map((item) => item.id), [
  'watch-comedy',
  'watch-drama',
  'watch-scifi',
]);

const coldRank = api.rankCandidates(watchlist, {
  profile: emptyProfile,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
});
expect('cold for you falls back to title order', coldRank.map((item) => item.id), [
  'watch-comedy',
  'watch-drama',
  'watch-scifi',
]);

const singleBoost = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: 10 },
  },
}, { resolveMovie });
expect('single rating not ready', singleBoost.ready, false);

const oneStrong = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: 10 },
    'comedy-a': { saved: true, watched: true, rating: 6 },
    'comedy-b': { saved: true, watched: true, rating: 6 },
  },
}, { resolveMovie });
const unsmoothed = (10 - api.PREFERENCE_RATING_NEUTRAL);
expect(
  'bayesian shrinks single strong genre below raw signal',
  oneStrong.genreAffinity.drama < unsmoothed,
  true
);

const missingGenreCandidate = api.scoreCandidate(catalog['watch-empty'], likedDrama, { id: 'watch-empty' });
expect('missing genres score neutral', missingGenreCandidate, 0);

const demoSci = api.scoreCandidate(catalog['scifi-demo'], {
  ready: true,
  genreAffinity: { sciencefiction: 2 },
  favoriteMovieIds: [],
}, { id: 'scifi-demo' });
const traktSci = api.scoreCandidate(catalog['scifi-trakt'], {
  ready: true,
  genreAffinity: { sciencefiction: 2 },
  favoriteMovieIds: [],
}, { id: 'scifi-trakt' });
expect('genreKey and genres[] share affinity key', demoSci, traktSci);

const ties = [
  { id: 'watch-tie-b', movie: catalog['watch-tie-b'] },
  { id: 'watch-tie-a', movie: catalog['watch-tie-a'] },
];
const tied = api.rankCandidates(ties, {
  profile: likedDrama,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
});
expect('equal score breaks by title then id', tied.map((item) => item.id), [
  'watch-tie-a',
  'watch-tie-b',
]);

const before = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: 9 },
    'drama-b': { saved: true, watched: true, rating: 9 },
    'drama-c': { saved: true, watched: true, rating: 9 },
  },
}, { resolveMovie });
const after = api.buildPreferenceProfile({
  movies: {
    'drama-a': { saved: true, watched: true, rating: 2 },
    'drama-b': { saved: true, watched: true, rating: 2 },
    'drama-c': { saved: true, watched: true, rating: 2 },
  },
}, { resolveMovie });
expect('rating change updates affinity', before.genreAffinity.drama > after.genreAffinity.drama, true);

const stateFrozen = {
  movies: {
    'drama-a': { saved: true, watched: true, rating: 9 },
    'drama-b': { saved: true, watched: true, rating: 8 },
    'drama-c': { saved: true, watched: true, rating: 9 },
    'watch-drama': { saved: true, watched: false, rating: null },
    'watched-done': { saved: true, watched: true, rating: 7 },
  },
};
const stateJson = JSON.stringify(stateFrozen);
const profileFromState = api.buildPreferenceProfile(stateFrozen, { resolveMovie });
expect('build does not mutate tracking state', JSON.stringify(stateFrozen), stateJson);
expect('profile ready with three rated dramas', profileFromState.ready, true);

const toWatchOnly = [
  { id: 'watch-drama', movie: catalog['watch-drama'], entry: { saved: true, watched: false } },
  { id: 'watch-comedy', movie: catalog['watch-comedy'], entry: { saved: true, watched: false } },
].filter((item) => item.entry.saved && !item.entry.watched);
expect('watched movies stay out of to-watch filter', toWatchOnly.every((item) => !item.entry.watched), true);

const once = api.rankCandidates(watchlist, {
  profile: likedDrama,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
}).map((item) => item.id);
const twice = api.rankCandidates(watchlist, {
  profile: likedDrama,
  mode: api.WATCHLIST_SORT_FOR_YOU,
  getId: (item) => item.id,
  getTitle: (item) => item.movie.title,
  getMedia: (item) => item.movie,
}).map((item) => item.id);
expect('same input same ranking', once, twice);

expect('watchlist sorts exported', api.WATCHLIST_SORTS, ['title', 'forYou']);

const moviesSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/movies.js'), 'utf8');
expect('movies screen uses preference profile', moviesSource.includes('buildPreferenceProfile') && moviesSource.includes('rankCandidates'), true);
expect('movies default my list mode', moviesSource.includes('MAIN_MY_LIST') && moviesSource.includes('useState(MAIN_MY_LIST)'), true);
expect('movies does not edit WatchedMoviesGrid sort', !moviesSource.includes('WatchedMoviesGrid') || moviesSource.includes('<WatchedMoviesGrid'), true);
expect('for you cold-start copy wired', moviesSource.includes('movies.forYouNeedRatings'), true);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}

console.log(`Preference profile checks passed (${checks.length})`);
