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

const people = loadModules(
  ['src/services/trakt/normalize.js', 'src/services/trakt/people.js'],
  'normalizePeoplePayload, pickHeadshotPath, collectEpisodeActors'
);
const crewUi = loadModules(
  ['src/components/people/crewPresentation.js'],
  'pickKeyCrewMembers, countCrewMembers, shouldAccordionDepartments, KEY_CREW_LIMIT'
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

const payload = {
  cast: [
    {
      characters: ['Jon Snow'],
      episode_count: 12,
      person: {
        name: 'Kit Harington',
        ids: { trakt: 11 },
        images: { headshot: ['media.trakt.tv/people/11/thumb/headshot.webp', 'media.trakt.tv/people/11/medium/headshot.webp'] },
      },
    },
    {
      characters: ['Also Guest'],
      person: {
        name: 'Overlap Actor',
        ids: { trakt: 22 },
        images: { headshot: [] },
      },
    },
  ],
  guest_stars: [
    {
      characters: ['Guest'],
      person: { name: 'Overlap Actor', ids: { trakt: 22 }, images: { headshot: [] } },
    },
    {
      characters: ['Extra'],
      person: { name: 'Guest Star', ids: { trakt: 55 }, images: { headshot: [] } },
    },
  ],
  crew: {
    writing: [
      {
        jobs: ['Writer'],
        person: { name: 'Writer One', ids: { trakt: 33 }, images: null },
      },
    ],
    directing: [
      {
        job: 'Director',
        person: { name: 'Director One', ids: { trakt: 44 }, images: null },
      },
    ],
  },
};

const normalized = people.normalizePeoplePayload(payload);
expect('cast is mapped', normalized.cast[0].name, 'Kit Harington');
expect('characters are mapped', normalized.cast[0].characters, ['Jon Snow']);
expect('episode counts are mapped', normalized.cast[0].episodeCount, 12);
expect('headshot prefers thumb', normalized.cast[0].headshotPath, 'media.trakt.tv/people/11/thumb/headshot.webp');
expect('guest stars are separate', normalized.guestStars[0].personId, 22);
expect('crew departments keep directing first', normalized.departments[0], 'directing');
expect('crew jobs array is mapped', normalized.crewByDepartment.writing[0].jobs, ['Writer']);
expect('legacy job string is mapped', normalized.crewByDepartment.directing[0].jobs, ['Director']);
expect('missing people are dropped', people.normalizePeoplePayload({ cast: [{ person: { name: 'No Id' } }] }).cast.length, 0);
expect('pickHeadshotPath returns null for empty images', people.pickHeadshotPath({ headshot: [] }), null);

const episodeActors = people.collectEpisodeActors(normalized);
expect('episode actors dedupe cast over guest', episodeActors.map((item) => item.personId), [11, 22, 55]);
expect('episode actors exclude crew', episodeActors.some((item) => item.personId === 33 || item.personId === 44), false);
expect('guest flag preserved for guests only', episodeActors.find((item) => item.personId === 55).isGuest, true);
expect('cast overlap stays non-guest', episodeActors.find((item) => item.personId === 22).isGuest, false);

const stats = votes.normalizeVoteStats([
  { person_trakt_id: 11, vote_count: 3, total_votes: 5, my_person_trakt_id: 11 },
  { person_trakt_id: 22, vote_count: 2, total_votes: 5, my_person_trakt_id: 11 },
]);
expect('vote totals are normalized', stats.totalVotes, 5);
expect('my vote is normalized', stats.myPersonId, 11);
const ranked = votes.rankPerformanceVotes(episodeActors, stats);
expect('votes are sorted high to low', ranked.map((item) => item.personId), [11, 22, 55]);
expect('percent uses total votes', ranked[0].percent, 60);
expect('selected person is marked', ranked[0].selected, true);
expect('empty stats start at zero', votes.emptyVoteStats().totalVotes, 0);
expect('detects missing rpc', votes.isVotesSetupUnavailable({ code: 'PGRST202', message: 'Could not find the function' }), true);
expect('detects votes_unavailable code', votes.isVotesSetupUnavailable({ code: 'votes_unavailable' }), true);
expect('ignores unrelated errors', votes.isVotesSetupUnavailable({ code: '42501', message: 'permission' }), false);

const keyCrew = crewUi.pickKeyCrewMembers(normalized);
expect('key crew prefers creator/director/writer/exec', keyCrew.map((item) => item.person.personId), [44, 33]);
expect('key crew stays within limit', keyCrew.length <= crewUi.KEY_CREW_LIMIT, true);
expect('crew count includes all departments', crewUi.countCrewMembers(normalized), 2);
expect('small crew skips department accordion', crewUi.shouldAccordionDepartments(normalized), false);

const castCrewSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/CastCrewSection.js'), 'utf8');
expect('show mode uses collapsible crew', castCrewSource.includes('collapsibleCrew = mode === \'show\''), true);
expect('crew show more uses i18n key', castCrewSource.includes('people.showMoreCrew'), true);
expect('episode path does not fetch show fallback', castCrewSource.includes('source: \'show-fallback\''), false);

const showSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');
const episodeSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/EpisodeDetailSheet.js'), 'utf8');
const actorsSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/EpisodeActorsBlock.js'), 'utf8');
const voteSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/PerformanceVoteSection.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261114180000_create_performance_votes.sql'), 'utf8');
expect('show detail renders cast crew', showSource.includes('<CastCrewSection mode="show"'), true);
expect('episode sheet uses episode actors block', episodeSource.includes('<EpisodeActorsBlock'), true);
expect('episode sheet does not use show cast section', episodeSource.includes('CastCrewSection'), false);
expect('episode actors block always renders voting', actorsSource.includes('<PerformanceVoteSection'), true);
expect('voting requires watched gate', voteSource.includes('watchToVote'), true);
expect('voting shows unavailable setup state', voteSource.includes('votesUnavailable'), true);
expect('voting uses portrait cards', voteSource.includes('vote-card-'), true);
expect('migration creates performance votes', migration.includes('create table public.performance_votes'), true);
expect('migration keeps one vote per user episode', migration.includes('unique (user_id, show_trakt_id, season_number, episode_number)'), true);
expect('migration exposes aggregate rpc', migration.includes('create or replace function public.performance_vote_stats'), true);
expect('migration grants rpc without exposing raw rows to anon', migration.includes('grant execute on function public.performance_vote_stats'), true);
expect('migration blocks authenticated table writes', migration.includes('revoke all on table public.performance_votes from public, anon, authenticated'), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`People checks passed (${checks.length})`);
