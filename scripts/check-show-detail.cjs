const fs = require('fs');
const path = require('path');

const showSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/show/[id].js'), 'utf8');
const episodeSheet = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/EpisodeDetailSheet.js'), 'utf8');
const overflow = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/ShowOverflowMenu.js'), 'utf8');
const rateChip = fs.readFileSync(path.join(__dirname, '..', 'src/components/ui/RateChip.js'), 'utf8');
const normalize = fs.readFileSync(path.join(__dirname, '..', 'src/services/trakt/normalize.js'), 'utf8');
const context = fs.readFileSync(path.join(__dirname, '..', 'src/tracking/TrackingContext.js'), 'utf8');

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
expect('show detail imports shared RateChip', showSource.includes("from '../../components/ui/RateChip'"));
expect('mark all is outside expanded season body', /markAll[\s\S]*seasonBody/.test(showSource.replace(/\s+/g, ' ')) || showSource.indexOf('styles.markAll') < showSource.indexOf('{open ? ('));
expect('mark all uses setSeasonWatched', showSource.includes('setSeasonWatched(show.id, seasonNumber, !allWatched)'));
expect('season toggle and mark all are separate pressables', (showSource.match(/styles\.seasonToggle/g) || []).length >= 1 && (showSource.match(/styles\.markAll/g) || []).length >= 1);
expect('episode rows open the detail sheet', showSource.includes('setSelectedEpisodeId(episode.id)'));
expect('episode check uses a separate pressable', showSource.includes('styles.episodeCheck'));
expect('episode title uses a separate pressable', showSource.includes('styles.episodeMain'));
expect('unwatched check marks then opens', showSource.includes('toggleEpisode(show.id, episode.id)') && showSource.includes('openEpisode()'));
expect('watched check opens without toggle when already watched', showSource.includes('if (!isWatched)') && showSource.includes('toggleEpisode(show.id, episode.id)'));
expect('episode rating requires watched in save handler', showSource.includes('if (!watched.has(ratingTarget.id))'));
expect('episode detail sheet is rendered', showSource.includes('<EpisodeDetailSheet'));
expect('episode sheet puts RateChip in the header', /headerCopy[\s\S]*RateChip/.test(episodeSheet.replace(/\s+/g, ' ')));
expect('episode sheet locks rating until watched', episodeSheet.includes('rating.watchToRate'));
expect('episode sheet uses RateChip once', (episodeSheet.match(/<RateChip/g) || []).length === 1);
expect('episode sheet disables rating when unwatched', episodeSheet.includes('canRate'));
expect('episode sheet has a single mark watched primary button', (episodeSheet.match(/tv\.markWatched/g) || []).length === 1);
expect('episode sheet has no lower ratingLocked block', !episodeSheet.includes('ratingLocked'));

const tvTab = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/index.js'), 'utf8');
const showCard = fs.readFileSync(path.join(__dirname, '..', 'src/components/tracking/ShowCard.js'), 'utf8');
expect('tv tab renders episode detail sheet', tvTab.includes('<EpisodeDetailSheet'));
expect('tv tab captures episode before mark advances', tvTab.includes('const episodeId = episode.id') && tvTab.includes('markNextWatched(showId)'));
expect('show card has no circular watch checkbox', !showCard.includes('ellipse-outline') && !showCard.includes('checkmark-circle'));
expect('show card shows explicit mark watched button', showCard.includes("t('tv.markWatched')"));
expect('show card episode info opens without marking', showCard.includes('onPress={openNextEpisode}'));
expect('episode sheet has top-right close button', episodeSheet.includes('styles.closeButton') && episodeSheet.includes('name="close"'));
expect('episode sheet has no bottom close text action', !episodeSheet.includes('styles.closeText'));
expect('overflow menu is rendered', showSource.includes('<ShowOverflowMenu'));
expect('stacked drop primary button is gone', !showSource.includes("label={t('tv.status.dropped')}"));
expect('stacked remove primary button is gone', !showSource.includes("<PrimaryButton label={t('tv.removeShow')"));
expect('rate chip opens show rating', showSource.includes("setRatingTarget({ type: 'show' })"));
expect('header mark show watched uses confirmation', showSource.includes('tv.markShowWatchedTitle'));
expect('header mark show watched calls setShowWatched', showSource.includes('setShowWatched(show.id)'));
expect('header shows completed indicator when caught up', showSource.includes('tv.markShowWatchedDone'));
expect('header actions sit beside rate and overflow', showSource.includes('styles.headerActions'));
expect('context exports setShowWatched', context.includes('setShowWatched'));
expect('rate chip uses star icon', rateChip.includes('star-outline'));
expect('episode sheet uses a modal', episodeSheet.includes('<Modal'));
expect('episode sheet supports watched toggle', episodeSheet.includes('onToggleWatched'));
expect('overflow menu uses a modal', overflow.includes('<Modal'));
expect('trakt episodes keep overview text', normalize.includes('overview: normalizeEpisodeOverview(episode.overview)'));
expect('episode sheet loads missing overviews on demand', episodeSheet.includes('fetchEpisodeOverview'));
expect('episode sheet uses dedicated missing-overview copy', episodeSheet.includes('tv.noEpisodeOverview'));
expect('episode sheet does not substitute show synopsis', !episodeSheet.includes('mediaSynopsis(t, show)') && !episodeSheet.includes('show.overview'));

const seasonsIndex = showSource.indexOf('seasons.map((seasonNumber)');
const castIndex = showSource.indexOf('<CastCrewSection mode="show"');
expect('seasons render before cast and crew', seasonsIndex >= 0 && castIndex > seasonsIndex);
expect('cast and crew appears once', (showSource.match(/<CastCrewSection mode="show"/g) || []).length === 1);
expect('seasons start collapsed', showSource.includes('useState({})') && showSource.includes('[expanded, setExpanded]'));
expect('movie detail is not modified for this layout', !fs.readFileSync(path.join(__dirname, '..', 'src/app/movie/[id].js'), 'utf8').includes('seasons.map((seasonNumber)'));
expect('show detail shows Trakt community rating', showSource.includes('trakt.communityRating') && showSource.includes('formatCommunityRating'));
expect('show detail has no TMDB community ratings UI', !showSource.includes('CommunityRatings') && !showSource.includes('tmdbId'));
expect('episode sheet has no community ratings row', !episodeSheet.includes('CommunityRatings') && !episodeSheet.includes('trakt.communityRating'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Show detail checks passed (${checks.length})`);
