const fs = require('fs');
const path = require('path');
const https = require('https');

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: actual === expected,
    actual,
    expected,
  });
}

const actorsSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/EpisodeActorsBlock.js'), 'utf8');
const voteSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/PerformanceVoteSection.js'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/EpisodeDetailSheet.js'), 'utf8');
const castCrew = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/CastCrewSection.js'), 'utf8');
const peopleService = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/people.js'), 'utf8');
const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/performance-vote/index.ts'), 'utf8');

expect('episode sheet uses EpisodeActorsBlock', sheet.includes('<EpisodeActorsBlock'));
expect('episode sheet does not use CastCrewSection', !sheet.includes('CastCrewSection'));
expect('episode actors fetch episode people only', actorsSource.includes('fetchEpisodePeople') && !actorsSource.includes('fetchShowPeople'));
expect('episode actors remount per episode key', actorsSource.includes('key={`${traktShowId}-${seasonNumber}-${episodeNumber}`}'));
expect('vote candidates come from episode actors', actorsSource.includes('candidates={actors}'));
expect('vote section scopes by show/season/episode', voteSource.includes('`${props.traktShowId}-${props.seasonNumber}-${props.episodeNumber}`'));
expect('people cache keys include episode numbers', peopleService.includes('`episode-people:${id}:${season}:${episode}`'));
expect('cast crew has no show-fallback source assignment', !castCrew.includes("source: 'show-fallback'") && !castCrew.includes('show-fallback'));
expect(
  'cast crew episode branch fetches episode people only',
  /if \(mode === 'episode'\) \{\s*return fetchEpisodePeople\(traktShowId, seasonNumber, episodeNumber\);\s*\}/.test(castCrew)
);
expect('edge validates against episode people endpoint', edge.includes('/seasons/${seasonNumber}/episodes/${episodeNumber}/people'));
expect('edge rejects actors missing from episode', edge.includes("error: 'actor_not_in_episode'"));
expect('edge cache key is episode scoped', edge.includes('`${showTraktId}:${seasonNumber}:${episodeNumber}`'));
expect('edge never uses show-wide people path for eligibility', !edge.includes('/shows/${encodeURIComponent(String(showTraktId))}/people?'));

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

/** Mirrors collectEpisodeActors + Edge extractEpisodeActorIds: cast then guests, unique Trakt IDs. */
function actorIds(payload) {
  const ids = [];
  const seen = new Set();
  const push = (entry) => {
    const traktId = Number(entry?.person?.ids?.trakt);
    if (!Number.isInteger(traktId) || traktId <= 0 || seen.has(traktId)) {
      return;
    }
    seen.add(traktId);
    ids.push(traktId);
  };
  (payload?.cast || []).forEach(push);
  (payload?.guest_stars || []).forEach(push);
  return ids.slice().sort((a, b) => a - b);
}

async function loadEpisode(slug, season, episode, extended) {
  return traktGet(
    `/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${episode}/people?extended=${encodeURIComponent(extended)}`
  );
}

(async () => {
  try {
    const gotE1Client = await loadEpisode('game-of-thrones', 1, 1, 'full,guest_stars');
    const gotE2Client = await loadEpisode('game-of-thrones', 1, 2, 'full,guest_stars');
    const bbE1Client = await loadEpisode('breaking-bad', 1, 1, 'full,guest_stars');
    const gotE1Edge = await loadEpisode('game-of-thrones', 1, 1, 'guest_stars');
    const gotE2Edge = await loadEpisode('game-of-thrones', 1, 2, 'guest_stars');
    const bbE1Edge = await loadEpisode('breaking-bad', 1, 1, 'guest_stars');
    const showGot = await traktGet('/shows/game-of-thrones/people?extended=full');

    const gotE1 = actorIds(gotE1Client);
    const gotE2 = actorIds(gotE2Client);
    const bbE1 = actorIds(bbE1Client);
    const gotE1EdgeIds = actorIds(gotE1Edge);
    const gotE2EdgeIds = actorIds(gotE2Edge);
    const bbE1EdgeIds = actorIds(bbE1Edge);
    const showGotIds = new Set(
      (showGot.cast || []).map((entry) => Number(entry?.person?.ids?.trakt)).filter((id) => id > 0)
    );

    const onlyE1 = gotE1.filter((id) => !gotE2.includes(id));
    const onlyE2 = gotE2.filter((id) => !gotE1.includes(id));
    const shared = gotE1.filter((id) => gotE2.includes(id));

    expect('GoT S01E01 unique actors', gotE1.length, 39);
    expect('GoT S01E02 unique actors', gotE2.length, 31);
    expect('BB S01E01 unique actors', bbE1.length, 15);
    expect('GoT E01/E02 shared actors', shared.length, 26);
    expect('GoT E01-only actors', onlyE1.length, 13);
    expect('GoT E02-only actors', onlyE2.length, 5);
    expect('GoT E01 client matches edge eligibility IDs', JSON.stringify(gotE1), JSON.stringify(gotE1EdgeIds));
    expect('GoT E02 client matches edge eligibility IDs', JSON.stringify(gotE2), JSON.stringify(gotE2EdgeIds));
    expect('BB E01 client matches edge eligibility IDs', JSON.stringify(bbE1), JSON.stringify(bbE1EdgeIds));
    expect('show-wide GoT cast is much larger than episode', showGotIds.size > gotE1.length * 5, true);
    expect('episode cast is not equal to show-wide cast', gotE1.length === showGotIds.size, false);

    const TIM_VAN_PATTEN = 32659;
    const VINCE_GILLIGAN = 423003;
    const gotE1CrewDirectors = (gotE1Client.crew?.directing || [])
      .map((entry) => Number(entry?.person?.ids?.trakt))
      .filter((id) => id > 0);
    const bbE1CrewDirectors = (bbE1Client.crew?.directing || [])
      .map((entry) => Number(entry?.person?.ids?.trakt))
      .filter((id) => id > 0);
    expect('GoT E01 lists Tim Van Patten in crew', gotE1CrewDirectors.includes(TIM_VAN_PATTEN), true);
    expect('GoT E01 excludes Tim Van Patten from Best Performance ids', gotE1.includes(TIM_VAN_PATTEN), false);
    expect('BB E01 lists Vince Gilligan in crew', bbE1CrewDirectors.includes(VINCE_GILLIGAN), true);
    expect('BB E01 excludes Vince Gilligan from Best Performance ids', bbE1.includes(VINCE_GILLIGAN), false);
    expect('GoT E01 and E02 never share identical candidate lists', JSON.stringify(gotE1) === JSON.stringify(gotE2), false);
  } catch (error) {
    expect(`live episode cast probe (${error.message})`, false, true);
  }

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  console.log(`Episode cast checks passed (${checks.length})`);
})();
