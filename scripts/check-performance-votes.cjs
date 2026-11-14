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
  ['src/services/supabase/performanceVoteRules.js'],
  'showMediaIdFromTraktId, extractEpisodeActorIds, isEpisodeActorEligible, parseVoteRequestBody'
);
const votes = loadModules(
  ['src/services/supabase/performanceVotes.js'],
  'normalizeVoteStats, rankPerformanceVotes, emptyVoteStats, isVotesSetupUnavailable'
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
  cast: [{ person: { ids: { trakt: 11 } } }],
  guest_stars: [{ person: { ids: { trakt: 22 } } }],
  crew: { directing: [{ person: { ids: { trakt: 44 } } }] },
};

expect('show media id maps trakt id', rules.showMediaIdFromTraktId(1390), 'trakt-show-1390');
expect('actor ids exclude crew', [...rules.extractEpisodeActorIds(peoplePayload)].sort(), [11, 22]);
expect('credited cast actor is eligible', rules.isEpisodeActorEligible(peoplePayload, 11), true);
expect('credited guest actor is eligible', rules.isEpisodeActorEligible(peoplePayload, 22), true);
expect('crew-only person is rejected', rules.isEpisodeActorEligible(peoplePayload, 44), false);
expect('arbitrary person is rejected', rules.isEpisodeActorEligible(peoplePayload, 999), false);

expect(
  'cast request parses',
  rules.parseVoteRequestBody({
    action: 'cast',
    showTraktId: 1390,
    seasonNumber: 1,
    episodeNumber: 1,
    personTraktId: 11,
  }),
  {
    ok: true,
    action: 'cast',
    showTraktId: 1390,
    seasonNumber: 1,
    episodeNumber: 1,
    personTraktId: 11,
  }
);
expect(
  'clear request parses without person',
  rules.parseVoteRequestBody({
    action: 'clear',
    showTraktId: 1390,
    seasonNumber: 1,
    episodeNumber: 1,
  }).ok,
  true
);
expect(
  'unauthenticated-shaped body without action rejected',
  rules.parseVoteRequestBody({ showTraktId: 1390, seasonNumber: 1, episodeNumber: 1 }).ok,
  false
);

const zero = votes.normalizeVoteStats([
  { person_trakt_id: null, vote_count: null, total_votes: 0, my_person_trakt_id: null },
]);
expect('zero vote row normalizes', zero, { totalVotes: 0, myPersonId: null, counts: {} });

const ranked = votes.rankPerformanceVotes(
  [{ personId: 11, name: 'A' }, { personId: 22, name: 'B' }],
  votes.normalizeVoteStats([
    { person_trakt_id: 22, vote_count: 3, total_votes: 5, my_person_trakt_id: 22 },
    { person_trakt_id: 11, vote_count: 2, total_votes: 5, my_person_trakt_id: 22 },
  ])
);
expect('ranking sorts by votes', ranked.map((item) => item.personId), [22, 11]);
expect('percentages use total', ranked[0].percent, 60);

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261114180000_create_performance_votes.sql'),
  'utf8'
);
expect('migration revokes client table grants', migration.includes('revoke all on table public.performance_votes from public, anon, authenticated'), true);
expect('migration grants table only to service_role', /grant select, insert, update, delete on table public\.performance_votes to service_role/.test(migration), true);
expect('migration does not grant insert to authenticated', /grant [^;]*insert[^;]*authenticated/i.test(migration), false);
expect('migration has no escaped count(\\*)', migration.includes('count(\\*)'), false);
expect('migration uses count(*)', migration.includes('count(*)'), true);
expect('migration has no escaped new\\.id', migration.includes('new\\.id'), false);
expect('migration regex tilde is unescaped when present', !migration.includes('~') || !migration.includes('\\~'), true);

const edge = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/performance-vote/index.ts'),
  'utf8'
);
expect('edge verifies caller via getUser', edge.includes('auth.getUser()'), true);
expect('edge never trusts client user_id for writes', /user_id:\s*body/.test(edge) || /user_id:\s*parsed/.test(edge), false);
expect('edge writes user.id from JWT', edge.includes('user_id: user.id'), true);
expect('edge checks watched episode_entries', edge.includes("eq('watched', true)"), true);
expect('edge validates trakt episode people', edge.includes('actor_not_in_episode'), true);
expect('edge rejects unauthenticated', edge.includes("error: 'unauthenticated'"), true);
expect('edge rejects unwatched', edge.includes("error: 'episode_not_watched'"), true);

const client = fs.readFileSync(
  path.join(__dirname, '..', 'src/services/supabase/performanceVotes.js'),
  'utf8'
);
expect('client votes through edge function', client.includes("functions.invoke('performance-vote'"), true);
expect('client no longer upserts performance_votes', client.includes(".from('performance_votes')"), false);

const sqlTest = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/tests/database/performance_votes_security.test.sql'),
  'utf8'
);
expect('sql test covers unauthenticated insert', sqlTest.includes('unauthenticated vote insert is rejected'), true);
expect('sql test covers direct authenticated bypass', sqlTest.includes('authenticated client cannot bypass Edge Function'), true);
expect('sql test covers cross-user update', sqlTest.includes('cannot update another users votes'), true);
expect('sql test covers aggregate stats', sqlTest.includes('aggregate stats return counts'), true);
expect('sql test covers second vote update', sqlTest.includes('second vote updates the existing row'), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Performance vote security checks passed (${checks.length})`);
