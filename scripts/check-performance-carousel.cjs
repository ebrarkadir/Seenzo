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
  'src/components/people/performanceVoteCarousel.js',
  'findPerformanceActorIndex, performanceCardLayout, shouldScrollToVotedActor, PERFORMANCE_CARD_WIDTH, PERFORMANCE_CARD_STRIDE'
);

const ranked = [
  { personId: 10, name: 'A' },
  { personId: 20, name: 'B' },
  { personId: 30, name: 'C' },
];

expect('finds selected actor after sort', api.findPerformanceActorIndex(ranked, 30), 2);
expect('missing actor returns -1', api.findPerformanceActorIndex(ranked, 99), -1);
expect('null person id returns -1', api.findPerformanceActorIndex(ranked, null), -1);

expect('layout uses fixed card width', api.performanceCardLayout(0).length, api.PERFORMANCE_CARD_WIDTH);
expect('layout offset grows by stride', api.performanceCardLayout(2).offset, 2 * api.PERFORMANCE_CARD_STRIDE);

expect('scroll after successful cast', api.shouldScrollToVotedActor({
  clearing: false,
  personId: 20,
  requestCurrent: 3,
  requestSeq: 3,
}), true);
expect('no scroll when clearing vote', api.shouldScrollToVotedActor({
  clearing: true,
  personId: 20,
  requestCurrent: 3,
  requestSeq: 3,
}), false);
expect('no scroll for stale response', api.shouldScrollToVotedActor({
  clearing: false,
  personId: 20,
  requestCurrent: 4,
  requestSeq: 3,
}), false);

const voteUi = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/people/PerformanceVoteSection.js'),
  'utf8'
);
expect('shared section used for movie and episode', voteUi.includes("mode === 'movie'") && voteUi.includes('FlatList'));
expect('scrolls by person id index not zero', voteUi.includes('findPerformanceActorIndex') && voteUi.includes('viewPosition: 0'));
expect('handles scrollToIndex failure', voteUi.includes('onScrollToIndexFailed'));
expect('clears pending scroll on failure', voteUi.includes('pendingScrollPersonId.current = null') && voteUi.includes('setStats(previousStats)'));
expect('waits until saving finishes before scroll', voteUi.includes('saving || loading'));

const movieBlock = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/people/MoviePerformanceBlock.js'),
  'utf8'
);
const episodeBlock = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/people/EpisodeActorsBlock.js'),
  'utf8'
);
expect('movie block uses shared vote section', movieBlock.includes('<PerformanceVoteSection'));
expect('episode block uses shared vote section', episodeBlock.includes('<PerformanceVoteSection'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Performance carousel checks passed (${checks.length})`);
