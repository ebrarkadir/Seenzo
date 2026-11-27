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
  ['src/tracking/preferenceProfile.js', 'src/data/labels.js'],
  ['formatGenreLabel', 'mediaGenreLine', 'normalizeGenre', 'mediaGenres'].join(', ')
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

const t = (key) => {
  const map = {
    'catalog.genres.drama': 'Drama',
    'catalog.genres.scienceFiction': 'Sci-Fi',
    'catalog.genres.thriller': 'Thriller',
    'catalog.genres.action': 'Action',
    'catalog.genres.comedy': 'Comedy',
    'catalog.genres.mystery': 'Mystery',
  };
  return map[key] || key;
};

expect('science-fiction → Sci-Fi', api.formatGenreLabel(t, 'science-fiction'), 'Sci-Fi');
expect('genreKey scienceFiction → Sci-Fi', api.formatGenreLabel(t, 'catalog.genres.scienceFiction'), 'Sci-Fi');
expect('drama passthrough', api.formatGenreLabel(t, 'drama'), 'Drama');
expect('unknown humanized', api.formatGenreLabel(t, 'neo-noir'), 'Neo Noir');
expect('empty genre null', api.formatGenreLabel(t, ''), null);

expect(
  'line joins up to three',
  api.mediaGenreLine(t, {
    genres: ['science fiction', 'thriller', 'drama', 'action'],
  }),
  'Sci-Fi · Thriller · Drama'
);

expect(
  'demo genreKey alone',
  api.mediaGenreLine(t, { genreKey: 'catalog.genres.mystery' }),
  'Mystery'
);

expect(
  'dedupes genres and genreKey',
  api.mediaGenreLine(t, {
    genres: ['Drama'],
    genreKey: 'catalog.genres.drama',
  }),
  'Drama'
);

expect('missing genres hidden', api.mediaGenreLine(t, { title: 'X' }), null);
expect('null media hidden', api.mediaGenreLine(t, null), null);

expect(
  'preference mediaGenres unchanged',
  api.mediaGenres({ genres: ['Science Fiction'], genreKey: 'catalog.genres.thriller' }),
  ['sciencefiction', 'thriller']
);

const moviesTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/movies.js'), 'utf8');
const orderRow = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/WatchlistOrderRow.js'), 'utf8');
const libraryTiles = fs.readFileSync(path.join(__dirname, '..', 'src/components/media/LibraryTiles.js'), 'utf8');
const posterTile = fs.readFileSync(path.join(__dirname, '..', 'src/components/media/PosterTile.js'), 'utf8');
const tvTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/index.js'), 'utf8');

expect('movies to-watch passes genreLine', moviesTab.includes('genreLine={mediaGenreLine(t, item.movie)}'), true);
expect('order row renders genres with ellipsis', orderRow.includes('styles.genres') && orderRow.includes('numberOfLines={1}'), true);
expect('watched posters pass genre detail', libraryTiles.includes('detail={genreLine}') && libraryTiles.includes('mediaGenreLine'), true);
expect('poster tile supports detail line', posterTile.includes('detail') && posterTile.includes('styles.detail'), true);
expect('tv plan passes genreLine', tvTab.includes('genreLine={mediaGenreLine(t, item.show)}'), true);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  failed.forEach((item) => {
    console.error(`FAIL ${item.name}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.actual)}`);
  });
  process.exit(1);
}
console.log(`Movie genre checks passed (${checks.length})`);
