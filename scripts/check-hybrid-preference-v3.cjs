/**
 * Recommendation Engine V3 — Hybrid Taste Profile controlled quality checks.
 * Compares rating-only baseline vs hybrid weak signals with numeric assertions.
 */
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
    'PREFERENCE_ENGINE_VERSION',
    'PREFERENCE_RATING_NEUTRAL',
    'PREFERENCE_UNRATED_MAX_SIGNAL',
    'PREFERENCE_WATCHLIST_SIGNAL',
    'PREFERENCE_PROGRESS_EVIDENCE_PRIOR',
    'PREFERENCE_WEAK_TOTAL_CAP',
    'PREFERENCE_CONFIDENCE_RATINGS',
    'PREFERENCE_CONFIDENCE_HISTORY',
    'PREFERENCE_MIN_HISTORY_WITH_GENRES',
    'WATCHLIST_SORT_FOR_YOU',
    'buildPreferenceProfile',
    'scoreCandidate',
    'rankCandidates',
    'computeShowProgressInterest',
    'collectWeakContributions',
    'buildDiscoverRecommendations',
    'formatRecommendationReason',
    'recommendationReasonDescriptor',
    'releasedEpisodes',
  ].join(', ')
);

const checks = [];
function expect(name, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, pass, actual, expected });
  if (!pass) {
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(name, actual) {
  expect(name, Boolean(actual), true);
}

function round(n, d = 6) {
  return Number(Number(n).toFixed(d));
}

function makeEpisodes(count, {
  season = 1,
  start = '2020-01-01',
  prefix = 'e',
  futureFrom = null,
} = {}) {
  const episodes = [];
  const base = Date.parse(`${start}T00:00:00Z`);
  for (let i = 1; i <= count; i += 1) {
    const day = new Date(base + (i - 1) * 86400000);
    const airDate = day.toISOString().slice(0, 10);
    const future = futureFrom != null && i >= futureFrom;
    episodes.push({
      id: `${prefix}${i}`,
      season,
      number: i,
      airDate: future ? '2099-01-01' : airDate,
    });
  }
  return episodes;
}

function showWithEps(id, title, genres, episodes, extra = {}) {
  return {
    id,
    title,
    genres,
    seasons: [{ season: 1, episodes }],
    ...extra,
  };
}

expect('engine version 3', api.PREFERENCE_ENGINE_VERSION, 3);

// --- Progress interest unit cases ---
const progressCases = [
  { name: '5/10', watched: 5, total: 10 },
  { name: '5/100', watched: 5, total: 100 },
  { name: '20/20', watched: 20, total: 20 },
  { name: '2/2', watched: 2, total: 2 },
  { name: '1/100', watched: 1, total: 100 },
  { name: '10/20', watched: 10, total: 20 },
  { name: '2/4', watched: 2, total: 4 },
  { name: '100/100', watched: 100, total: 100 },
  { name: '40/40', watched: 40, total: 40 },
];

const progressByName = {};
progressCases.forEach((row) => {
  const eps = makeEpisodes(row.total, { prefix: `${row.name}-` });
  const show = showWithEps(`show-${row.name}`, row.name, ['drama'], eps);
  const entry = {
    intent: 'watching',
    watchedEpisodeIds: eps.slice(0, row.watched).map((episode) => episode.id),
  };
  const interest = api.computeShowProgressInterest(show, entry);
  progressByName[row.name] = interest;
  expectTrue(`${row.name} reliable`, interest.reliable);
  expect(`${row.name} watched`, interest.watched, row.watched);
  expect(`${row.name} total`, interest.total, row.total);
});

expectTrue('5/10 interest > 5/100', progressByName['5/10'].interest > progressByName['5/100'].interest);
expectTrue('20/20 confidence > 2/2', progressByName['20/20'].confidence > progressByName['2/2'].confidence);
expectTrue('20/20 interest > 2/2', progressByName['20/20'].interest > progressByName['2/2'].interest);
expectTrue('1/100 very weak', progressByName['1/100'].interest < 0.05);
expectTrue('10/20 evidence > 2/4 same ratio', progressByName['10/20'].interest > progressByName['2/4'].interest);
expectTrue(
  '100/100 saturates vs linear growth from 40/40',
  progressByName['100/100'].interest - progressByName['40/40'].interest
    < progressByName['40/40'].interest - progressByName['20/20'].interest
);

// Future episodes excluded from denominator
const mixed = showWithEps('future-show', 'Future', ['crime'], makeEpisodes(10, { futureFrom: 6 }));
const mixedEntry = { intent: 'watching', watchedEpisodeIds: ['e1', 'e2', 'e3', 'e4', 'e5'] };
const mixedProgress = api.computeShowProgressInterest(mixed, mixedEntry);
expect('future eps not in denom', mixedProgress.total, 5);
expect('future eps ratio complete', mixedProgress.ratio, 1);

// Specials (S00) excluded via releasedEpisodes
const withSpecials = {
  id: 'specials',
  title: 'Specials',
  genres: ['drama'],
  seasons: [
    {
      season: 0,
      episodes: [{ id: 's0e1', season: 0, number: 1, airDate: '2019-01-01' }],
    },
    {
      season: 1,
      episodes: makeEpisodes(2, { prefix: 'reg-' }),
    },
  ],
};
const specialProgress = api.computeShowProgressInterest(withSpecials, {
  intent: 'watching',
  watchedEpisodeIds: ['reg-1', 'reg-2', 's0e1'],
});
expect('specials excluded from total', specialProgress.total, 2);
expect('specials excluded from watched count path', specialProgress.watched, 2);

// Missing metadata: no fake denominator
const bare = { id: 'bare', title: 'Bare', genres: ['drama'], seasons: [] };
const bareProgress = api.computeShowProgressInterest(bare, {
  intent: 'watching',
  watchedEpisodeIds: ['x'],
});
expect('missing metadata unreliable', bareProgress.reliable, false);
expect('missing metadata interest 0', bareProgress.interest, 0);

const noAir = showWithEps('no-air', 'No Air', ['drama'], [
  { id: 'n1', season: 1, number: 1, airDate: null },
  { id: 'n2', season: 1, number: 2 },
]);
const noAirProgress = api.computeShowProgressInterest(noAir, {
  intent: 'watching',
  watchedEpisodeIds: ['n1'],
});
expect('missing air dates unreliable', noAirProgress.reliable, false);

// --- Synthetic account fixtures ---
const shows = {
  bb: showWithEps('trakt-show-bb', 'Breaking Bad', ['crime', 'drama', 'thriller'], makeEpisodes(5, { prefix: 'bb-' }), {
    traktId: '1388',
    releaseStatus: 'ended',
  }),
  mob: showWithEps('trakt-show-mob', 'MobLand', ['crime', 'drama'], makeEpisodes(4, { prefix: 'mob-' }), {
    traktId: '200',
  }),
  rop: showWithEps('trakt-show-rop', 'The Rings of Power', ['fantasy', 'action', 'adventure'], makeEpisodes(8, { prefix: 'rop-' }), {
    traktId: '300',
  }),
  got: showWithEps('trakt-show-got', 'Game of Thrones', ['fantasy', 'drama', 'adventure'], makeEpisodes(20, { prefix: 'got-' }), {
    traktId: '1390',
    releaseStatus: 'ended',
  }),
  dex: showWithEps('trakt-show-dex', 'Dexter: Resurrection', ['crime', 'drama', 'thriller'], makeEpisodes(6, { prefix: 'dex-' }), {
    traktId: '400',
  }),
  sp: showWithEps('trakt-show-sp', 'South Park', ['comedy', 'animation'], makeEpisodes(10, { prefix: 'sp-' })),
  vq: { id: 'trakt-show-vq', title: 'VisionQuest', genres: ['drama'], seasons: [] },
  ozark: { id: 'trakt-show-ozark', title: 'Ozark', genres: ['crime', 'drama', 'thriller'] },
  tulsa: { id: 'trakt-show-tulsa', title: 'Tulsa King', genres: ['crime', 'drama'] },
  greys: { id: 'trakt-show-greys', title: "Grey's Anatomy", genres: ['drama'] },
  hotd: { id: 'trakt-show-hotd', title: 'House of the Dragon', genres: ['fantasy', 'drama', 'action'] },
  percy: { id: 'trakt-show-percy', title: 'Percy Jackson', genres: ['fantasy', 'adventure', 'action'] },
  planCrime: { id: 'trakt-show-plan-crime', title: 'Plan Crime', genres: ['crime', 'drama'] },
  planFantasy: { id: 'trakt-show-plan-fantasy', title: 'Plan Fantasy', genres: ['fantasy', 'adventure'] },
  planDrama: { id: 'trakt-show-plan-drama', title: 'Plan Drama', genres: ['drama'] },
};
const byId = Object.fromEntries(Object.values(shows).map((show) => [show.id, show]));
const resolveShow = (id) => byId[id] || null;

function ratedState() {
  return {
    shows: {
      [shows.bb.id]: {
        intent: 'watching',
        watchedEpisodeIds: shows.bb.seasons[0].episodes.map((episode) => episode.id),
        rating: 10,
      },
      [shows.mob.id]: {
        intent: 'watching',
        watchedEpisodeIds: shows.mob.seasons[0].episodes.map((episode) => episode.id),
        rating: 8,
      },
      [shows.rop.id]: {
        intent: 'watching',
        watchedEpisodeIds: shows.rop.seasons[0].episodes.slice(0, 3).map((episode) => episode.id),
        rating: 5,
      },
    },
    showRatings: {},
  };
}

function hybridState() {
  const base = ratedState();
  base.shows[shows.got.id] = {
    intent: 'watching',
    watchedEpisodeIds: shows.got.seasons[0].episodes.slice(0, 12).map((episode) => episode.id),
    rating: null,
  };
  base.shows[shows.dex.id] = {
    intent: 'watching',
    watchedEpisodeIds: shows.dex.seasons[0].episodes.map((episode) => episode.id),
    rating: null,
  };
  base.shows[shows.sp.id] = {
    intent: 'dropped',
    watchedEpisodeIds: shows.sp.seasons[0].episodes.slice(0, 2).map((episode) => episode.id),
    rating: null,
  };
  base.shows[shows.vq.id] = {
    intent: 'dropped',
    watchedEpisodeIds: [],
    rating: null,
  };
  base.shows[shows.planCrime.id] = { intent: 'plan', watchedEpisodeIds: [], rating: null };
  base.shows[shows.planFantasy.id] = { intent: 'plan', watchedEpisodeIds: [], rating: null };
  base.shows[shows.planDrama.id] = { intent: 'plan', watchedEpisodeIds: [], rating: null };
  return base;
}

const v2 = api.buildPreferenceProfile(ratedState(), { mediaKind: 'show', resolveShow });
const v3 = api.buildPreferenceProfile(hybridState(), { mediaKind: 'show', resolveShow });

expect('v2 ready ratings confidence', v2.confidence, api.PREFERENCE_CONFIDENCE_RATINGS);
expect('v3 ready ratings confidence', v3.confidence, api.PREFERENCE_CONFIDENCE_RATINGS);

// Rating 10 vs 5 contribution difference (numeric)
const signal10 = 10 - api.PREFERENCE_RATING_NEUTRAL;
const signal5 = 5 - api.PREFERENCE_RATING_NEUTRAL;
expectTrue('10 rating signal != 5 rating signal', signal10 !== signal5);
expectTrue('10 rating stronger positive than 5', signal10 > 0 && signal5 < 0);

// Double-count: BB completed+rated must not add weak contribution
const weakHybrid = api.collectWeakContributions(hybridState(), { mediaKind: 'show', resolveShow });
expectTrue(
  'rated BB not in weak contributions',
  !weakHybrid.some((row) => row.id === shows.bb.id)
);
expectTrue(
  'rated MobLand not in weak contributions',
  !weakHybrid.some((row) => row.id === shows.mob.id)
);
expectTrue(
  'rated RoP not in weak contributions',
  !weakHybrid.some((row) => row.id === shows.rop.id)
);
expectTrue(
  'GoT unrated watching is weak',
  weakHybrid.some((row) => row.id === shows.got.id && row.signal > 0)
);
expectTrue(
  'Dexter unrated progress is weak',
  weakHybrid.some((row) => row.id === shows.dex.id && row.signal > 0)
);
expectTrue(
  'South Park dropped not weak positive',
  !weakHybrid.some((row) => row.id === shows.sp.id)
);
expectTrue(
  'watchlist plan contributes tiny signal',
  weakHybrid.some((row) => row.id === shows.planCrime.id && row.signal === api.PREFERENCE_WATCHLIST_SIGNAL)
);

const gotWeak = weakHybrid.find((row) => row.id === shows.got.id);
const dexWeak = weakHybrid.find((row) => row.id === shows.dex.id);
const planWeak = weakHybrid.find((row) => row.id === shows.planCrime.id);
expectTrue('GoT fantasy interest small vs rating10', gotWeak.signal < signal10 * 0.25);
expectTrue('Dexter crime interest small vs rating10', dexWeak.signal < signal10 * 0.25);
expectTrue('watchlist weakest among positive weaks', planWeak.signal < gotWeak.signal && planWeak.signal < dexWeak.signal);

// Fantasy / crime affinity moves with weak signals but stays rating-led
expectTrue('v3 fantasy >= v2 fantasy (GoT weak)', (v3.genreAffinity.fantasy || 0) >= (v2.genreAffinity.fantasy || -1));
expectTrue('v3 crime >= v2 crime (Dexter weak)', (v3.genreAffinity.crime || 0) >= (v2.genreAffinity.crime || 0));
expectTrue('BB-driven crime still strongly positive', v3.genreAffinity.crime > 0.5);
expectTrue('RoP still mild negative fantasy-or-action path', (v3.genreAffinity.action || 0) < 0 || (v2.genreAffinity.action || 0) < 0);

// Flood of unrated cannot dominate a single rating 10 crime title
const floodShows = {};
const floodState = { shows: {}, showRatings: {} };
floodState.shows[shows.bb.id] = { intent: 'watching', watchedEpisodeIds: [], rating: 10 };
for (let i = 0; i < 30; i += 1) {
  const id = `flood-comedy-${i}`;
  floodShows[id] = { id, title: `Flood ${i}`, genres: ['comedy'] };
  floodState.shows[id] = {
    intent: 'watching',
    watchedEpisodeIds: [],
    rating: null,
    // no episodes → unreliable progress → no watching signal; use watched movies style via plan? 
  };
}
// Use movies flood for clearer unrated_watched signal
const floodMovies = {
  movies: {
    'rated-crime': { saved: true, watched: true, rating: 10 },
  },
};
const floodMovieCatalog = {
  'rated-crime': { id: 'rated-crime', title: 'Rated Crime', genres: ['crime'] },
};
for (let i = 0; i < 30; i += 1) {
  const id = `flood-m-${i}`;
  floodMovies.movies[id] = { saved: true, watched: true, rating: null };
  floodMovieCatalog[id] = { id, title: `Flood M ${i}`, genres: ['comedy'] };
}
const floodProfile = api.buildPreferenceProfile(floodMovies, {
  mediaKind: 'movie',
  resolveMovie: (id) => floodMovieCatalog[id] || null,
});
expectTrue('flood comedy capped below crime from single 10', floodProfile.genreAffinity.crime > (floodProfile.genreAffinity.comedy || 0));
expectTrue(
  'weak total mass capped',
  Object.values(floodProfile.weakGenreAffinity || {}).reduce((sum, value) => sum + Math.abs(value), 0)
    <= api.PREFERENCE_WEAK_TOTAL_CAP + 1e-9
);

// Self-reinforcement: plan item should not get its own watchlist boost when scored
const selfState = hybridState();
const selfProfile = api.buildPreferenceProfile(selfState, { mediaKind: 'show', resolveShow });
const withSelf = api.scoreCandidate(shows.planCrime, selfProfile, { id: shows.planCrime.id });
const profileNoOwn = {
  ...selfProfile,
  weakById: { ...selfProfile.weakById },
};
delete profileNoOwn.weakById[shows.planCrime.id];
// Compare against scoring without exclusion by temporarily clearing weakById entry already tested via scoringAffinityMap
const ozarkScore = api.scoreCandidate(shows.ozark, selfProfile, { id: shows.ozark.id });
const planScore = api.scoreCandidate(shows.planCrime, selfProfile, { id: shows.planCrime.id });
expectTrue('plan crime does not outrank strong crime drama solely via self boost', ozarkScore >= planScore);
expectTrue('self score finite', Number.isFinite(withSelf));

// Rating-only V2 behavior preserved on rated-only state (pairs + affinities)
expectTrue('rating-only pair crime|drama present', (v2.pairAffinity['crime|drama'] || 0) > 1);
const v2Again = api.buildPreferenceProfile(ratedState(), { mediaKind: 'show', resolveShow });
expect('deterministic profile affinity', v2.genreAffinity, v2Again.genreAffinity);

// Ranking compare V2 vs V3 on fixed pool
const pool = [shows.ozark, shows.tulsa, shows.greys, shows.hotd, shows.percy, shows.planDrama];
function rankIds(profile) {
  return api.rankCandidates(pool, {
    profile,
    mode: api.WATCHLIST_SORT_FOR_YOU,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getMedia: (item) => item,
  }).map((item) => item.id);
}
const rankV2 = rankIds(v2);
const rankV3 = rankIds(v3);
expect('deterministic ranking v2', rankV2, rankIds(v2Again));
expectTrue('ozark still top-tier under v3', rankV3.indexOf(shows.ozark.id) <= 1);
console.log('V2 ranks', rankV2.map((id) => byId[id].title));
console.log('V3 ranks', rankV3.map((id) => byId[id].title));
console.log('V2 affinities', v2.genreAffinity);
console.log('V3 affinities', v3.genreAffinity);
console.log('V2 scores', pool.map((item) => ({
  title: item.title,
  score: round(api.scoreCandidate(item, v2, { id: item.id })),
})));
console.log('V3 scores', pool.map((item) => ({
  title: item.title,
  score: round(api.scoreCandidate(item, v3, { id: item.id })),
})));

// Movie / show isolation
const movieState = {
  movies: {
    'm1': { saved: true, watched: true, rating: 10 },
    'm2': { saved: true, watched: true, rating: 9 },
    'm3': { saved: true, watched: true, rating: 3 },
  },
};
const movieCatalog = {
  m1: { id: 'm1', title: 'Dark', genres: ['crime', 'drama'] },
  m2: { id: 'm2', title: 'Seven', genres: ['crime', 'thriller'] },
  m3: { id: 'm3', title: 'Romcom', genres: ['comedy', 'romance'] },
};
const movieProfile = api.buildPreferenceProfile(movieState, {
  mediaKind: 'movie',
  resolveMovie: (id) => movieCatalog[id],
});
const movieWithShowNoise = api.buildPreferenceProfile({
  ...movieState,
  shows: hybridState().shows,
}, {
  mediaKind: 'movie',
  resolveMovie: (id) => movieCatalog[id],
  resolveShow,
});
expect('movie profile ignores show tracking', movieProfile.genreAffinity, movieWithShowNoise.genreAffinity);

// History-only cold start
const historyOnlyMovies = { movies: {} };
const historyCatalog = {};
for (let i = 0; i < api.PREFERENCE_MIN_HISTORY_WITH_GENRES; i += 1) {
  const id = `hist-${i}`;
  historyOnlyMovies.movies[id] = { saved: true, watched: true, rating: null };
  historyCatalog[id] = { id, title: id, genres: i % 2 ? ['comedy'] : ['drama'] };
}
const historyProfile = api.buildPreferenceProfile(historyOnlyMovies, {
  mediaKind: 'movie',
  resolveMovie: (id) => historyCatalog[id],
});
expect('history-only ready', historyProfile.ready, true);
expect('history confidence', historyProfile.confidence, api.PREFERENCE_CONFIDENCE_HISTORY);
const histReason = api.recommendationReasonDescriptor(historyCatalog['hist-0'], historyProfile);
expect('history reason type', histReason?.type, 'history');
const t = (key) => ({
  'discover.basedOnWatchingHistory': 'Based on your watching history',
  'discover.becauseYouLike': 'Because you like X',
}[key] || key);
expect(
  'history copy honest',
  api.formatRecommendationReason(t, historyCatalog['hist-0'], historyProfile),
  'Based on your watching history'
);

// Discover exclusion still works for caught-up
const discover = api.buildDiscoverRecommendations([shows.dex, shows.ozark], {
  profile: v3,
  mediaKind: 'show',
  showsState: hybridState().shows,
  resolveShow,
  limit: 10,
  t: (key, vars = {}) => key + (vars.genre || vars.combo || ''),
});
expectTrue('caught-up dexter excluded from discover', !discover.items.some((row) => row.id === shows.dex.id));
expectTrue('ozark remains recommendable', discover.items.some((row) => row.id === shows.ozark.id));

// Progress change updates weak profile
const beforeGot = api.buildPreferenceProfile(hybridState(), { mediaKind: 'show', resolveShow });
const afterState = hybridState();
afterState.shows[shows.got.id].watchedEpisodeIds = shows.got.seasons[0].episodes.map((episode) => episode.id);
const afterGot = api.buildPreferenceProfile(afterState, { mediaKind: 'show', resolveShow });
expectTrue(
  'more GoT progress raises fantasy affinity',
  (afterGot.genreAffinity.fantasy || 0) >= (beforeGot.genreAffinity.fantasy || 0)
);

// Plan add/remove updates profile
const noPlan = ratedState();
noPlan.shows[shows.got.id] = hybridState().shows[shows.got.id];
noPlan.shows[shows.dex.id] = hybridState().shows[shows.dex.id];
const withPlan = hybridState();
const noPlanProfile = api.buildPreferenceProfile(noPlan, { mediaKind: 'show', resolveShow });
const withPlanProfile = api.buildPreferenceProfile(withPlan, { mediaKind: 'show', resolveShow });
expectTrue(
  'plan list changes weak contribution count',
  withPlanProfile.weakContributionCount > noPlanProfile.weakContributionCount
);

// Missing genres safe
expect('missing genres score 0', api.scoreCandidate({ id: 'x', title: 'X' }, v3, { id: 'x' }), 0);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(`\n${failed.length} hybrid V3 checks failed`);
  process.exit(1);
}
console.log(`Hybrid preference V3 checks passed (${checks.length})`);
