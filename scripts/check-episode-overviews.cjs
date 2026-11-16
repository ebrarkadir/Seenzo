const fs = require('fs');
const path = require('path');
const https = require('https');

function loadModule(relativePath, returned) {
  const file = path.join(__dirname, '..', relativePath);
  const code = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export \{[^}]+\};?\s*$/gm, '')
    .replace(/^export /gm, '');
  return new Function(`${code}\nreturn { ${returned} };`)();
}

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: actual === expected,
    actual,
    expected,
  });
}

const normalize = loadModule(
  'src/services/trakt/normalize.js',
  'normalizeEpisodeOverview, mergeEpisodeOverview, toAppShow'
);
const episodesSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/episodes.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/catalog.js'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/EpisodeDetailSheet.js'), 'utf8');
const library = fs.readFileSync(path.join(__dirname, '..', 'src/data/mediaLibrary.js'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/i18n/locales/en.json'), 'utf8'));

expect('normalize trims overview text', normalize.normalizeEpisodeOverview('  Hello world  '), 'Hello world');
expect('normalize drops non-strings', normalize.normalizeEpisodeOverview(null), '');
expect(
  'merge keeps existing overview when incoming is empty',
  normalize.mergeEpisodeOverview({ id: 'trakt-episode-1', overview: 'Kept' }, '').overview,
  'Kept'
);
expect(
  'merge replaces empty overview with incoming text',
  normalize.mergeEpisodeOverview({ id: 'trakt-episode-1', overview: '' }, ' Fresh ').overview,
  'Fresh'
);

const show = normalize.toAppShow(
  { title: 'Probe', ids: { trakt: 99 } },
  [{
    number: 1,
    episode_count: 1,
    episodes: [{
      ids: { trakt: 1001 },
      number: 1,
      title: 'Pilot',
      overview: '  A real episode summary.  ',
      first_aired: '2008-01-21T02:00:00.000Z',
    }],
  }],
  true
);
expect('toAppShow preserves trimmed episode overview', show.seasons[0].episodes[0].overview, 'A real episode summary.');

expect('episode service fetches single episode full details', episodesSource.includes('/seasons/${season}/episodes/${episode}'));
expect('episode service uses extended=full', episodesSource.includes("extended: 'full'"));
expect('episode service dedupes in-flight requests', episodesSource.includes('inflight'));
expect('hydrate caches season episode overviews', catalogSource.includes('rememberCachedEpisodeOverview'));
expect('media library can patch episode overview', library.includes('export function patchEpisodeOverview'));
expect('media library preserves existing overviews on rememberShow', library.includes('mergePreservedEpisodeOverviews'));
expect('popup fetches missing overview on open', sheet.includes('fetchEpisodeOverview('));
expect('popup shows missing-overview fallback', sheet.includes('tv.noEpisodeOverview'));
expect('popup never uses series overview for episode body', !sheet.includes('show.overview') && !sheet.includes('mediaSynopsis(t, show)'));
expect('i18n missing overview copy is set', en.tv.noEpisodeOverview, 'No episode description available.');

function traktGet(pathname) {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const clientId = (env.match(/^EXPO_PUBLIC_TRAKT_CLIENT_ID=(.+)$/m) || [])[1]?.trim();
  if (!clientId) {
    throw new Error('missing_trakt_client_id');
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.trakt.tv',
        path: pathname,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Seenzo/1.0.0',
          'trakt-api-key': clientId,
          'trakt-api-version': '2',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`trakt_${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function assertLiveOverview(slug, season, number, titleHint) {
  const payload = await traktGet(
    `/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${number}?extended=full`
  );
  const overview = typeof payload?.overview === 'string' ? payload.overview.trim() : '';
  expect(`live ${slug} S${season}E${number} has overview`, overview.length > 40, true);
  if (titleHint) {
    expect(`live ${slug} S${season}E${number} title`, payload.title, titleHint);
  }
  const seasonList = await traktGet(
    `/shows/${encodeURIComponent(slug)}/seasons/${season}?extended=full`
  );
  const match = Array.isArray(seasonList)
    ? seasonList.find((item) => item.number === number)
    : null;
  const seasonOverview = typeof match?.overview === 'string' ? match.overview.trim() : '';
  expect(`season payload includes ${slug} S${season}E${number} overview`, seasonOverview.length > 40, true);
  expect(
    `single and season overview match for ${slug} S${season}E${number}`,
    seasonOverview,
    overview
  );
}

(async () => {
  try {
    await assertLiveOverview('breaking-bad', 1, 1, 'Pilot');
    await assertLiveOverview('game-of-thrones', 1, 1, 'Winter Is Coming');
    await assertLiveOverview('the-office', 1, 1, 'Pilot');
  } catch (error) {
    expect(`live trakt overview probe (${error.message})`, false, true);
  }

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  console.log(`Episode overview checks passed (${checks.length})`);
})();
