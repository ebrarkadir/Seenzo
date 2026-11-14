const fs = require('fs');
const path = require('path');

function loadModule(relativePath, returned, prelude = '') {
  const file = path.join(__dirname, '..', relativePath);
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/^import .*$/gm, '');
  code = code.replace(/^export /gm, '');
  return new Function(`${prelude}\n${code}\nreturn { ${returned} };`)();
}

const config = loadModule(
  'src/services/trakt/config.js',
  'inspectTraktClientId, TRAKT_CLIENT_ID_PLACEHOLDER'
);
const client = loadModule(
  'src/services/trakt/client.js',
  'buildTraktUrl, summarizeImages, mapMedia, mapSeason, mapEpisode',
  'function getTraktConfigStatus(){ return { ready: true, reason: "ready" }; }'
);

const checks = [];
function expect(name, actual, expected) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

expect('missing client id', config.inspectTraktClientId(''), { ready: false, reason: 'missing' });
expect('blank client id', config.inspectTraktClientId('   '), { ready: false, reason: 'missing' });
expect(
  'placeholder client id',
  config.inspectTraktClientId(config.TRAKT_CLIENT_ID_PLACEHOLDER),
  { ready: false, reason: 'placeholder' }
);
expect('configured client id', config.inspectTraktClientId('client-id'), { ready: true, reason: 'ready' });

expect(
  'search query is encoded',
  client.buildTraktUrl('/search/movie', { query: 'dune & part 2', extended: 'full', limit: 10 }),
  'https://api.trakt.tv/search/movie?query=dune%20%26%20part%202&extended=full&limit=10'
);
expect(
  'show id path stays a single segment',
  client.buildTraktUrl('/shows/breaking-bad/seasons', { extended: 'full' }),
  'https://api.trakt.tv/shows/breaking-bad/seasons?extended=full'
);

const images = client.summarizeImages({
  poster: ['https://walter.trakt.tv/images/secret.webp'],
  fanart: ['https://walter.trakt.tv/images/other.webp', 'https://walter.trakt.tv/images/third.webp'],
});
expect('image metadata counts urls without exposing them', images, { poster: 1, fanart: 2 });
expect('image summary contains no url', JSON.stringify(images).includes('http'), false);

const media = client.mapMedia({
  title: 'Example',
  year: 2020,
  ids: { trakt: 10, slug: 'example-2020' },
  rating: 8.2,
  overview: 'A summary',
  status: 'ended',
  images: { poster: ['https://walter.trakt.tv/images/poster.webp'] },
});
expect('mapped media keeps title', media.title, 'Example');
expect('mapped media drops image urls', JSON.stringify(media).includes('trakt.tv'), false);

expect('season requires a number', client.mapSeason({ title: 'Missing number' }), null);
expect(
  'episode keeps number and title',
  client.mapEpisode({ season: 1, number: 2, title: 'Pilot', first_aired: '2020-01-02T00:00:00.000Z' }).title,
  'Pilot'
);

const normalize = loadModule(
  'src/services/trakt/normalize.js',
  'toAppShow, toAppMovie, pickPosterPath, airDateFromTrakt, traktShowKey, seasonNeedsEpisodeFetch, mergeCatalogPage'
);
const show = normalize.toAppShow(
  {
    title: 'Example Show',
    year: 2010,
    ids: { trakt: 42 },
    status: 'ended',
    rating: 8.5,
    images: { poster: ['walter.trakt.tv/images/shows/posters/original/a.webp', 'walter.trakt.tv/images/shows/posters/thumb/b.webp'] },
  },
  [{
    number: 1,
    episodes: [{ season: 1, number: 1, title: 'Pilot', ids: { trakt: 7 }, first_aired: '2010-01-02T00:00:00.000Z' }],
  }],
  true
);
expect('show id is provider qualified', show.id, 'trakt-show-42');
expect('thumb poster is preferred', show.posterPath.endsWith('/thumb/b.webp'), true);
expect('episode air date is the calendar date', show.seasons[0].episodes[0].airDate, '2010-01-02');
expect('missing air date stays empty', normalize.airDateFromTrakt(null), null);
expect('impossible air date stays empty', normalize.airDateFromTrakt('2026-13-40T00:00:00.000Z'), null);
expect('season without episodes needs a fetch', normalize.seasonNeedsEpisodeFetch({ number: 2, episodes: [] }), true);
expect('season that already includes episodes is not fetched again', normalize.seasonNeedsEpisodeFetch({ number: 2, episodes: [{ ids: { trakt: 1 } }] }), false);
expect('season without a number is not fetched', normalize.seasonNeedsEpisodeFetch({ episodes: [] }), false);
expect(
  'later pages do not duplicate titles',
  normalize.mergeCatalogPage([{ id: 'trakt-movie-1' }, { id: 'trakt-movie-2' }], [{ id: 'trakt-movie-2' }, { id: 'trakt-movie-3' }]).map((item) => item.id),
  ['trakt-movie-1', 'trakt-movie-2', 'trakt-movie-3']
);
const parentSeason = normalize.toAppShow(
  { title: 'Seasoned', ids: { trakt: 5 }, status: 'returning' },
  [{ number: 1, episodes: [{ number: 1, title: 'One', ids: { trakt: 9 }, first_aired: '2024-05-06T00:00:00.000Z' }] }],
  true
);
expect('episode uses the season number when the episode omits it', parentSeason.seasons[0].episodes[0].season, 1);
expect('movie id does not collide with show id', normalize.toAppMovie({ title: 'Example', ids: { trakt: 42 } }).id, 'trakt-movie-42');
expect('normalized show does not keep image urls in other fields', JSON.stringify({ title: show.title, overview: show.overview }).includes('trakt.tv'), false);

const artwork = loadModule('src/services/artwork/url.js', 'artworkRemoteUrl');
expect('artwork accepts a trakt thumb path', artwork.artworkRemoteUrl('walter.trakt.tv/images/posters/thumb/a.webp').includes('/thumb/'), true);
expect('artwork rejects a non-trakt host', artwork.artworkRemoteUrl('https://example.com/poster.webp'), null);
expect('artwork rejects a path that leaves the cache key', artwork.artworkRemoteUrl('walter.trakt.tv/images/../../secret.webp'), null);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(`Trakt client checks passed (${checks.length})`);
