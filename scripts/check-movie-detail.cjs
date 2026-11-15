const fs = require('fs');
const path = require('path');

const movieSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/movie/[id].js'), 'utf8');
const people = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/people.js'), 'utf8');
const castCrew = fs.readFileSync(path.join(__dirname, '..', 'src/components/people/CastCrewSection.js'), 'utf8');
const showSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');

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
expect('movie detail loads movie cast crew', movieSource.includes('<CastCrewSection mode="movie"'));
expect('movie people endpoint is movies/{id}/people', people.includes('/movies/${encodeURIComponent(id)}/people'));
expect('fetchMoviePeople is exported', people.includes('export function fetchMoviePeople'));
expect('cast crew movie mode does not call show people', /mode === 'movie'[\s\S]*fetchMoviePeople/.test(castCrew.replace(/\s+/g, ' ')));
expect('tv show detail still uses show cast crew', showSource.includes('<CastCrewSection mode="show"'));
expect('movie detail has no season controls', !movieSource.includes('setSeasonWatched') && !movieSource.includes('EpisodeDetailSheet'));
expect('movie detail preserves mark watched', movieSource.includes("saveMovie(movie.id, { watched: true, saved: true })"));
expect('movie detail shows watched chip when done', movieSource.includes('markChipDone'));
expect('movie detail formats community rating', movieSource.includes('formatCommunityRating'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Movie detail checks passed (${checks.length})`);
