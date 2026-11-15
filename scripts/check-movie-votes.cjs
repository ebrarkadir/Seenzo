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

const rules = loadModules(
  ['src/services/supabase/moviePerformanceVoteRules.js'],
  'movieMediaIdFromTraktId, extractMovieActorIds, isMovieActorEligible, parseMovieVoteRequestBody'
);
const people = loadModules(
  ['src/services/trakt/normalize.js', 'src/services/trakt/people.js'],
  'normalizePeoplePayload, collectMovieActors, collectEpisodeActors'
);
const movieClientSource = fs.readFileSync(
  path.join(__dirname, '..', 'src/services/supabase/moviePerformanceVotes.js'),
  'utf8'
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

const peoplePayload = {
  cast: [{ person: { ids: { trakt: 11 }, name: 'Lead' } }],
  guest_stars: [{ person: { ids: { trakt: 22 }, name: 'Guest' } }],
  crew: { directing: [{ person: { ids: { trakt: 44 }, name: 'Director' }, jobs: ['Director'] }] },
};

expect('movie media id maps trakt id', rules.movieMediaIdFromTraktId(1), 'trakt-movie-1');
expect('movie actor ids exclude crew and guests', [...rules.extractMovieActorIds(peoplePayload)], [11]);
expect('credited cast actor is eligible', rules.isMovieActorEligible(peoplePayload, 11), true);
expect('guest is not movie candidate', rules.isMovieActorEligible(peoplePayload, 22), false);
expect('crew-only person is rejected', rules.isMovieActorEligible(peoplePayload, 44), false);

expect(
  'cast request parses',
  rules.parseMovieVoteRequestBody({
    action: 'cast',
    movieTraktId: 1,
    personTraktId: 11,
  }),
  {
    ok: true,
    action: 'cast',
    movieTraktId: 1,
    personTraktId: 11,
  }
);
expect(
  'clear request parses without person',
  rules.parseMovieVoteRequestBody({ action: 'clear', movieTraktId: 1 }).ok,
  true
);
expect(
  'invalid movie id rejected',
  rules.parseMovieVoteRequestBody({ action: 'cast', movieTraktId: 0, personTraktId: 11 }).ok,
  false
);

const normalized = people.normalizePeoplePayload({
  cast: [
    {
      characters: ['Cobb'],
      person: { name: 'Leonardo DiCaprio', ids: { trakt: 11 }, images: { headshot: [] } },
    },
  ],
  crew: {
    directing: [{ jobs: ['Director'], person: { name: 'Nolan', ids: { trakt: 44 }, images: null } }],
  },
});
expect('collectMovieActors excludes crew', people.collectMovieActors(normalized).map((item) => item.personId), [11]);
expect('collectMovieActors keeps characters', people.collectMovieActors(normalized)[0].characters, ['Cobb']);

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261115220000_create_movie_performance_votes.sql'),
  'utf8'
);
expect('migration revokes client table grants', migration.includes('revoke all on table public.movie_performance_votes from public, anon, authenticated'), true);
expect('migration grants table only to service_role', /grant select, insert, update, delete on table public\.movie_performance_votes to service_role/.test(migration), true);
expect('migration does not grant insert to authenticated', /grant [^;]*insert[^;]*authenticated/i.test(migration), false);
expect('migration uses count(*)', migration.includes('count(*)'), true);
expect('migration creates separate movie table', migration.includes('create table public.movie_performance_votes'), true);
expect('migration does not alter episode votes', migration.includes('performance_votes') && !migration.includes('alter table public.performance_votes'), true);

const edge = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/movie-performance-vote/index.ts'),
  'utf8'
);
expect('edge verifies caller via getUser', edge.includes('auth.getUser()'), true);
expect('edge writes user.id from JWT', edge.includes('user_id: user.id'), true);
expect('edge checks watched media_entries', edge.includes("eq('movie_watched', true)"), true);
expect('edge validates trakt movie people', edge.includes('actor_not_in_movie'), true);
expect('edge rejects unauthenticated', edge.includes("error: 'unauthenticated'"), true);
expect('edge rejects unwatched', edge.includes("error: 'movie_not_watched'"), true);
expect('edge uses movie people path', edge.includes('/movies/'), true);
expect('edge does not write episode votes table', !edge.includes("from('performance_votes')"), true);

const voteUi = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/people/PerformanceVoteSection.js'),
  'utf8'
);
expect('vote ui supports movie mode', voteUi.includes("mode === 'movie'"), true);
expect('vote ui uses movie cast/clear APIs', voteUi.includes('castMoviePerformanceVote') && voteUi.includes('clearMoviePerformanceVote'), true);

const block = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/people/MoviePerformanceBlock.js'),
  'utf8'
);
expect('movie block loads movie people', block.includes('fetchMoviePeople'), true);
expect('movie block uses collectMovieActors', block.includes('collectMovieActors'), true);
expect('movie block passes watched gate', block.includes('watched={watched}'), true);

expect('client votes through movie edge function', movieClientSource.includes("functions.invoke('movie-performance-vote'"), true);
expect('client no longer upserts movie_performance_votes', movieClientSource.includes(".from('movie_performance_votes')"), false);
expect('client detects movie votes unavailable', movieClientSource.includes('isMovieVotesSetupUnavailable'), true);
expect('client uses movie_performance_vote_stats rpc', movieClientSource.includes("rpc('movie_performance_vote_stats'"), true);

const sqlTest = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/tests/database/movie_performance_votes_security.test.sql'),
  'utf8'
);
expect('sql test covers unauthenticated insert', sqlTest.includes('unauthenticated vote insert is rejected'), true);
expect('sql test covers direct authenticated bypass', sqlTest.includes('authenticated client cannot bypass Edge Function'), true);
expect('sql test covers cross-user update', sqlTest.includes('cannot update another users votes'), true);
expect('sql test covers aggregate stats', sqlTest.includes('aggregate stats return counts'), true);
expect('sql test covers second vote update', sqlTest.includes('second vote updates the existing row'), true);
expect('sql test keeps episode table intact', sqlTest.includes('episode performance_votes table remains available'), true);

const episodeEdge = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/performance-vote/index.ts'),
  'utf8'
);
expect('episode edge function remains unchanged path', episodeEdge.includes('episode_entries'), true);

expect(
  'unavailable detector mentions movie rpc name',
  movieClientSource.includes('movie_performance_vote_stats')
    && movieClientSource.includes('movie-performance-vote'),
  true
);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Movie vote checks passed (${checks.length})`);
