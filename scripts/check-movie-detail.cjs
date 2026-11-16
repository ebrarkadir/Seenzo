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

const movieSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/movie/[id].js'), 'utf8');
const moviesTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/movies.js'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/MovieDetailSheet.js'), 'utf8');
const peopleSections = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/MoviePeopleSections.js'), 'utf8');
const castCrew = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/CastCrewSection.js'), 'utf8');
const people = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/people.js'), 'utf8');
const showSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');
const libraryTiles = fs.readFileSync(path.join(__dirname, '..', 'src/components/media/LibraryTiles.js'), 'utf8');
const posterTile = fs.readFileSync(path.join(__dirname, '..', 'src/components/media/PosterTile.js'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/i18n/locales/en.json'), 'utf8'));
const crewUi = loadModules(
  ['src/components/people/crewPresentation.js'],
  'pickKeyCrewMembers, KEY_CREW_LIMIT, MOVIE_KEY_CREW_LIMIT, MOVIE_CAST_PREVIEW_COUNT, CAST_PREVIEW_COUNT'
);

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: actual === expected,
    actual,
    expected,
  });
}

expect('movie detail uses compact RateChip', movieSource.includes('<RateChip'));
expect('movie detail uses overflow menu', movieSource.includes('<ShowOverflowMenu'));
expect('movie detail uses header actions row', movieSource.includes('styles.headerActions'));
expect('movie detail has no stacked PrimaryButton rate row', !movieSource.includes('styles.rateRow'));
expect('movie detail uses shared people sections', movieSource.includes('<MoviePeopleSections'));
expect('movie people endpoint is movies/{id}/people', people.includes('/movies/${encodeURIComponent(id)}/people'));
expect('fetchMoviePeople is exported', people.includes('export function fetchMoviePeople'));
expect('collectMovieActors is exported', people.includes('export function collectMovieActors'));
expect('cast crew movie mode does not call show people', /mode === 'movie'[\s\S]*fetchMoviePeople/.test(castCrew.replace(/\s+/g, ' ')));
expect('tv show detail still uses show cast crew', showSource.includes('<CastCrewSection mode="show"'));
expect('tv seasons still precede cast', showSource.indexOf('seasons.map((seasonNumber)') < showSource.indexOf('<CastCrewSection mode="show"'));
expect('movie detail has no season controls', !movieSource.includes('setSeasonWatched') && !movieSource.includes('EpisodeDetailSheet'));
expect('movie detail preserves mark watched', movieSource.includes("saveMovie(movie.id, { watched: true, saved: true })"));
expect('movie detail shows watched chip when done', movieSource.includes('markChipDone'));
expect('movie detail shows Trakt community rating', movieSource.includes('trakt.communityRating') && movieSource.includes('formatCommunityRating'));
expect('movie detail has no TMDB community ratings UI', !movieSource.includes('CommunityRatings') && !movieSource.includes('tmdbId'));
expect('movie detail disables rating until watched', movieSource.includes('disabled={!watched}'));
expect('movie detail shows watch-to-rate copy', movieSource.includes('rating.watchToRateMovie'));
expect('movie detail gates rating sheet on watched', movieSource.includes('visible={ratingOpen && watched}'));
expect('movies tab captures id before mark watched', moviesTab.includes('markWatchedAndOpen'));
expect('movies tab opens movie detail sheet', moviesTab.includes('<MovieDetailSheet'));
expect('to-watch cards show labeled mark watched overlay', libraryTiles.includes("t('movies.markWatched')") && libraryTiles.includes('bottomOverlay') && libraryTiles.includes('styles.markWatched'));
expect('mark watched overlay sits inside poster frame', posterTile.includes('bottomOverlaySlot') && posterTile.includes("bottom: 0"));
expect('mark watched uses solid Seenzo blue', libraryTiles.includes('backgroundColor: colors.primary') && !libraryTiles.includes('rgba('));
expect('mark watched uses dark on-primary text', libraryTiles.includes('color: colors.onPrimary') && libraryTiles.includes("fontWeight: '700'"));
expect('to-watch cards have no below-poster mark watched margin', !libraryTiles.includes('marginTop: spacing.sm,\n    minHeight: 32'));
expect('to-watch cards have no standalone quick checkmark', !libraryTiles.includes('onQuick') && !posterTile.includes('onQuick'));
expect('movie sheet uses Android back close', sheet.includes('onRequestClose={closeSheet}'));
expect('movie sheet has close button', sheet.includes('movies.closeMovie'));
expect('movie sheet includes rate chip', sheet.includes('<RateChip'));
expect('movie sheet uses shared people sections', sheet.includes('<MoviePeopleSections'));
expect('movie sheet does not undo watched on close', !sheet.includes('watched: false'));
expect('i18n has movie watch-to-rate copy', en.rating.watchToRateMovie.includes('movie'));
expect('i18n has movie performance prompt', en.people.performancePromptMovie.includes('movie'));

const castPart = peopleSections.indexOf('parts="cast"');
const voteIndex = peopleSections.indexOf('<MoviePerformanceBlock');
const crewPart = peopleSections.indexOf('parts="crew"');
expect('cast renders before best performance', castPart >= 0 && voteIndex > castPart);
expect('best performance renders before crew', voteIndex >= 0 && crewPart > voteIndex);
expect('shared sections render performance once', (peopleSections.match(/<MoviePerformanceBlock/g) || []).length === 1);
expect('shared sections split cast and crew', (peopleSections.match(/parts="cast"/g) || []).length === 1 && (peopleSections.match(/parts="crew"/g) || []).length === 1);
expect('shared sections call fetchMoviePeople once', (peopleSections.match(/fetchMoviePeople\(/g) || []).length === 1);
expect('shared sections reuse people for voting', peopleSections.includes('candidates={candidates}'));
expect('cast crew supports parts split', castCrew.includes("parts === 'cast'") && castCrew.includes("parts === 'crew'"));
expect('movie cast preview is compact', crewUi.MOVIE_CAST_PREVIEW_COUNT, 5);
expect('show cast preview stays larger', crewUi.CAST_PREVIEW_COUNT, 12);
expect('movie crew preview is compact', crewUi.MOVIE_KEY_CREW_LIMIT, 3);
expect('show crew preview stays larger', crewUi.KEY_CREW_LIMIT, 6);
expect('cast crew uses movie cast preview count', castCrew.includes('MOVIE_CAST_PREVIEW_COUNT'));
expect('cast crew uses movie crew preview limit', castCrew.includes('MOVIE_KEY_CREW_LIMIT'));

const movieLike = {
  departments: ['directing', 'writing', 'production'],
  crewByDepartment: {
    directing: [
      { personId: 1, name: 'D', jobs: ['Director'] },
      { personId: 2, name: 'AD', jobs: ['Assistant Director'] },
    ],
    writing: [{ personId: 3, name: 'W', jobs: ['Writer'] }],
    production: [
      { personId: 4, name: 'P', jobs: ['Producer'] },
      { personId: 5, name: 'EP', jobs: ['Executive Producer'] },
    ],
  },
};
const compactCrew = crewUi.pickKeyCrewMembers(movieLike, crewUi.MOVIE_KEY_CREW_LIMIT);
expect('compact movie crew starts with director', compactCrew[0].person.personId, 1);
expect('compact movie crew keeps writer second', compactCrew[1].person.personId, 3);
expect('compact movie crew stays within three', compactCrew.length <= 3, true);
expect('compact movie crew excludes assistant director', compactCrew.every((item) => item.person.personId !== 2), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Movie detail checks passed (${checks.length})`);
