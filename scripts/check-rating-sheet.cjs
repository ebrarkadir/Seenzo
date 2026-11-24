const fs = require('fs');
const path = require('path');

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
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const api = loadModule(
  'src/components/ui/ratingPresentation.js',
  'starsFromRating, clampDiscreteRating, toggleStarRating, starFillAt, ratingDescriptorKey'
);

expect('null rating has zero stars', api.starsFromRating(null), 0);
expect('1 maps to half star', api.starsFromRating(1), 0.5);
expect('2 maps to one star', api.starsFromRating(2), 1);
expect('7 maps to 3.5 stars', api.starsFromRating(7), 3.5);
expect('9 maps to 4.5 stars', api.starsFromRating(9), 4.5);
expect('10 maps to five stars', api.starsFromRating(10), 5);

expect('null tap 4 -> 8', api.toggleStarRating(null, 4), 8);
expect('8 tap 4 -> 7', api.toggleStarRating(8, 4), 7);
expect('7 tap 4 -> 8', api.toggleStarRating(7, 4), 8);
expect('8 tap 5 -> 10', api.toggleStarRating(8, 5), 10);
expect('10 tap 5 -> 9', api.toggleStarRating(10, 5), 9);
expect('7 tap 3 -> 6', api.toggleStarRating(7, 3), 6);
expect('tap never clears to zero', api.toggleStarRating(2, 1), 1);
expect('all integers reachable', [1, 2, 3, 4, 5].flatMap((star) => {
  const full = api.toggleStarRating(null, star);
  const half = api.toggleStarRating(full, star);
  return [half, full];
}).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

expect('star fill half for rating 7 star 4', api.starFillAt(7, 4), 0.5);
expect('star fill full for rating 7 star 3', api.starFillAt(7, 3), 1);
expect('star fill empty for rating 7 star 5', api.starFillAt(7, 5), 0);

const sheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/ui/RatingSheet.js'), 'utf8');
expect('no community slider', !sheet.includes('@react-native-community/slider'));
expect('no plus minus controls', !sheet.includes('rating.increase') && !sheet.includes('rating.decrease'));
expect('interactive star toggle', sheet.includes('toggleStarRating') && sheet.includes('InteractiveStars'));
expect('exact half clip rendering', sheet.includes('starHalfClip'));
expect('has close icon not footer close text', sheet.includes('name="close"') && !sheet.includes('styles.closeText'));
expect('save disabled when unrated', sheet.includes('value == null'));
expect('remove only when saved exists', sheet.includes('savedValue != null'));
expect('optional review field present', sheet.includes('rating.review.placeholder'));
expect('spoiler toggle wired', sheet.includes('SpoilerToggle'));
expect('no calculator grid cells', !sheet.includes('styles.cell') && !sheet.includes('gridRow'));

const usages = [
  'src/app/movie/[id].js',
  'src/app/show/[id].js',
  'src/app/(tabs)/index.js',
  'src/app/personal-ratings.js',
  'src/components/tracking/MovieDetailSheet.js',
].map((relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'));

expect('all entry points still use RatingSheet', usages.every((source) => source.includes('<RatingSheet')));

const movieSheet = usages[4];
const showSource = usages[1];
const tvHome = usages[2];
expect(
  'movie sheet hides parent modal while rating',
  movieSheet.includes('movieSheetVisible') && movieSheet.includes('!ratingOpen')
);
expect(
  'show detail hides episode sheet while rating episode',
  showSource.includes("ratingTarget?.type !== 'episode'")
);
expect(
  'tv home hides episode sheet while rating',
  tvHome.includes('Boolean(selectedEpisode) && !ratingTarget')
);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Rating sheet checks passed (${checks.length})`);
