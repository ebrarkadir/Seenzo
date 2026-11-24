const fs = require('fs');
const path = require('path');

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const auth = read('src/auth/AuthContext.js');
expect(
  'signOut always clears local session',
  auth.includes("signOut({ scope: 'local' })")
    && auth.includes('setSession(null);')
    && !auth.includes('if (!error) {\n      setSession(null);')
);

const home = read('src/app/(tabs)/index.js');
expect(
  'home closes rating sheet with episode sheet',
  home.includes('setSelected(null);')
    && home.includes('setRatingTarget(null);')
    && home.includes('setDraft(null);')
    && /onClose=\{\(\) => \{\s*setSelected\(null\);\s*setRatingTarget\(null\);\s*setDraft\(null\);/s.test(home)
);

const showDetail = read('src/app/show/[id].js');
expect(
  'show detail closes episode rating with episode sheet',
  showDetail.includes('closingEpisodeRating')
    && showDetail.includes("ratingTarget?.type === 'episode'")
    && showDetail.includes('setRatingTarget(null)')
    && showDetail.includes('setDraft(null)')
);
expect(
  'show detail keeps show-level rating target when closing episode',
  showDetail.includes('if (closingEpisodeRating)')
);

const votes = read('src/components/people/PerformanceVoteSection.js');
expect(
  'vote stats load uses dedicated loadSeq',
  votes.includes('const loadSeq = useRef(0);')
    && votes.includes('loadSeq.current !== seq')
    && votes.includes('loadSeq.current = seq')
);
expect(
  'vote mutations keep separate requestSeq',
  votes.includes('const requestSeq = useRef(0);')
    && votes.includes('requestSeq.current !== seq')
);

const editProfile = read('src/app/edit-profile.js');
expect(
  'edit profile reseeds fields after async profile load',
  editProfile.includes('loading')
    && editProfile.includes('seedKey')
    && editProfile.includes('!dirty')
    && editProfile.includes('setDisplayName(profile.displayName || \'\')')
);

const movieDetail = read('src/app/movie/[id].js');
expect(
  'movie rating sheet gated by watched',
  movieDetail.includes('visible={ratingOpen && watched}')
);
expect(
  'movie detail does not auto-watch on rate open',
  !/setRatingOpen\(true\)[\s\S]{0,80}setMovieRating|mark.*watched.*ratingOpen/i.test(movieDetail)
);

const personalRatings = read('src/app/personal-ratings.js');
expect(
  'personal ratings reuses tracking setters',
  personalRatings.includes('setMovieRating')
    && personalRatings.includes('setShowRating')
    && personalRatings.includes('setEpisodeRating')
);
expect(
  'personal ratings blocks uneditable items before save',
  personalRatings.includes('!item.editable')
    && personalRatings.includes('lockedTitle')
);

const profile = read('src/app/(tabs)/profile.js');
expect(
  'profile favorites shelves remain',
  (profile.match(/<FavoriteShelf/g) || []).length >= 2
);
expect(
  'profile media routes preserved',
  profile.includes('/edit-profile') && profile.includes('/personal-ratings')
);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Reliability checks passed (${checks.length})`);
