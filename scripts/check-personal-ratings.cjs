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

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const api = loadModules(
  ['src/tracking/watchlist.js', 'src/tracking/personalRatings.js'],
  [
    'countPersonalRatings',
    'countPersonalRatingsByKind',
    'collectPersonalRatings',
    'filterPersonalRatings',
    'searchPersonalRatings',
    'sortPersonalRatings',
    'enrichPersonalRatingItem',
    'buildPersonalRatingsView',
    'PERSONAL_RATING_SORTS',
    'isEpisodeWatched',
  ].join(', ')
);

const state = {
  movies: {
    'trakt-movie-1': { saved: true, watched: true, rating: 9 },
    'trakt-movie-2': { saved: true, watched: false, rating: 7 },
    'trakt-movie-3': { saved: true, watched: true, rating: null },
  },
  shows: {
    'trakt-show-1': { intent: 'watching', watchedEpisodeIds: ['trakt-episode-10'], rating: 10 },
    'trakt-show-2': { intent: 'plan', watchedEpisodeIds: [], rating: null },
  },
  showRatings: {
    'trakt-show-3': 8,
  },
  episodeRatings: {
    'trakt-episode-10': 8,
    'trakt-episode-11': 6,
  },
  episodeMeta: {
    'trakt-episode-10': { showId: 'trakt-show-1', season: 1, number: 1 },
    'trakt-episode-11': { showId: 'trakt-show-1', season: 1, number: 2 },
  },
  keptEpisodes: {},
};

expect('count matches movies + unique shows + episodes', api.countPersonalRatings(state), 2 + 2 + 2);

const collected = api.collectPersonalRatings(state);
expect('collects rated movies including unwatched preserved', collected.filter((item) => item.kind === 'movie').length, 2);
expect('unwatched movie not editable', collected.find((item) => item.id === 'trakt-movie-2').editable, false);
expect('watched movie editable', collected.find((item) => item.id === 'trakt-movie-1').editable, true);
expect('tracked show rating included', collected.some((item) => item.id === 'trakt-show-1' && item.kind === 'show'), true);
expect('parked show rating included', collected.some((item) => item.id === 'trakt-show-3' && item.kind === 'show'), true);
expect('show ratings always editable', collected.filter((item) => item.kind === 'show').every((item) => item.editable), true);
expect('watched episode editable', collected.find((item) => item.id === 'trakt-episode-10').editable, true);
expect('unwatched episode not editable', collected.find((item) => item.id === 'trakt-episode-11').editable, false);

const counts = api.countPersonalRatingsByKind(collected);
expect('kind counts', counts, { all: 6, movie: 2, show: 2, episode: 2 });

const moviesOnly = api.filterPersonalRatings(collected, 'movie');
expect('filter movies', moviesOnly.every((item) => item.kind === 'movie') && moviesOnly.length === 2, true);

const enriched = collected.map((item) => api.enrichPersonalRatingItem(item, {
  resolveMovie: (id) => (id === 'trakt-movie-1' ? { id, title: 'Inception', year: 2010, posterPath: '/a.jpg' } : null),
  resolveShow: (id) => (id === 'trakt-show-1' ? {
    id,
    title: 'Breaking Bad',
    year: 2008,
    posterPath: '/b.jpg',
    seasons: [{ season: 1, episodes: [{ id: 'trakt-episode-10', season: 1, number: 1, title: 'Pilot', posterPath: null }] }],
  } : id === 'trakt-show-3' ? { id, title: 'Parked Show', year: 2011, posterPath: '/c.jpg' } : null),
  listEpisodes: (show) => (show?.seasons || []).flatMap((season) => (season.episodes || []).map((episode) => ({ ...episode, season: episode.season ?? season.season }))),
}));

const searched = api.searchPersonalRatings(enriched, 'inception');
expect('search finds movie title', searched.map((item) => item.id), ['trakt-movie-1']);

const episodeSearch = api.searchPersonalRatings(enriched, 'pilot');
expect('search finds episode title', episodeSearch.some((item) => item.id === 'trakt-episode-10'), true);

const highest = api.sortPersonalRatings(enriched, 'highest');
expect('highest rated first', highest[0].rating >= highest[1].rating, true);

const lowest = api.sortPersonalRatings(enriched, 'lowest');
expect('lowest rated first', lowest[0].rating <= lowest[1].rating, true);

const titled = api.sortPersonalRatings(
  enriched.filter((item) => item.title),
  'title'
);
expect('title sort deterministic', titled[0].title <= titled[1].title, true);

expect('no recently-rated sort option', api.PERSONAL_RATING_SORTS.includes('recent'), false);

const view = api.buildPersonalRatingsView(state, {
  filter: 'all',
  sort: 'highest',
  resolveMovie: () => null,
  resolveShow: () => null,
  listEpisodes: () => [],
});
expect('build view length', view.length, 6);

const profileSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/profile.js'), 'utf8');
expect('profile uses shared count helper', profileSource.includes('countPersonalRatings'));
expect('profile navigates to personal-ratings', profileSource.includes("router.push('/personal-ratings')"));

const layoutSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/_layout.js'), 'utf8');
expect('stack registers personal-ratings route', layoutSource.includes('personal-ratings'));

const screenSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/personal-ratings.js'), 'utf8');
expect('reuses RatingSheet', screenSource.includes('RatingSheet'));
expect('reuses setMovieRating/setShowRating/setEpisodeRating', screenSource.includes('setMovieRating') && screenSource.includes('setShowRating') && screenSource.includes('setEpisodeRating'));
expect('does not invent ratedAt sorting', !screenSource.includes('ratedAt') && !screenSource.includes('recently'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Personal ratings checks passed (${checks.length})`);
