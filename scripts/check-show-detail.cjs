const fs = require('fs');
const path = require('path');

const showSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');
const episodeSheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/EpisodeDetailSheet.js'), 'utf8');
const overflow = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/ShowOverflowMenu.js'), 'utf8');
const normalize = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/normalize.js'), 'utf8');

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: actual === expected,
    actual,
    expected,
  });
}

expect('show detail imports episode sheet', showSource.includes("from '../../components/tracking/EpisodeDetailSheet'"));
expect('show detail imports overflow menu', showSource.includes("from '../../components/tracking/ShowOverflowMenu'"));
expect('mark all is outside expanded season body', /markAll[\s\S]*seasonBody/.test(showSource.replace(/\s+/g, ' ')) || showSource.indexOf('styles.markAll') < showSource.indexOf('{open ? ('));
expect('mark all uses setSeasonWatched', showSource.includes('setSeasonWatched(show.id, seasonNumber, !allWatched)'));
expect('season toggle and mark all are separate pressables', (showSource.match(/styles\.seasonToggle/g) || []).length >= 1 && (showSource.match(/styles\.markAll/g) || []).length >= 1);
expect('episode rows open the detail sheet', showSource.includes('setSelectedEpisodeId(episode.id)'));
expect('episode rows do not toggle watched directly', !/onPress=\{\(\) => toggleEpisode\(show\.id, episode\.id\)\}/.test(showSource));
expect('episode detail sheet is rendered', showSource.includes('<EpisodeDetailSheet'));
expect('overflow menu is rendered', showSource.includes('<ShowOverflowMenu'));
expect('stacked drop primary button is gone', !showSource.includes("label={t('tv.status.dropped')}"));
expect('stacked remove primary button is gone', !showSource.includes("<PrimaryButton label={t('tv.removeShow')"));
expect('rate chip opens show rating', showSource.includes("setRatingTarget({ type: 'show' })"));
expect('episode sheet uses a modal', episodeSheet.includes('<Modal'));
expect('episode sheet supports watched toggle', episodeSheet.includes('onToggleWatched'));
expect('overflow menu uses a modal', overflow.includes('<Modal'));
expect('trakt episodes keep overview text', normalize.includes('overview: typeof episode.overview === \'string\' ? episode.overview : \'\''));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Show detail checks passed (${checks.length})`);
