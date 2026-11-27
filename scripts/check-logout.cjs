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

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const routing = loadModules(
  ['src/auth/sessionRouting.js'],
  'resolveSessionDestination, resolveRootRedirect'
);

// A. Logout with stale onboardingComplete must still show AuthGateway
expect(
  'A logout destination is gateway even if onboardingComplete stays true',
  routing.resolveSessionDestination({
    signedIn: false,
    onboardingComplete: true,
    demoMode: false,
  }),
  'gateway'
);
expect(
  'A logout from tabs redirects to gateway',
  routing.resolveRootRedirect({
    signedIn: false,
    onboardingComplete: true,
    demoMode: false,
    route: '(tabs)',
  }),
  { action: 'replace', to: '/', reason: 'signed_out_to_gateway' }
);

// B. App restart after logout (signed out, no demo)
expect(
  'B restart signed-out incomplete opens gateway',
  routing.resolveSessionDestination({
    signedIn: false,
    onboardingComplete: false,
    demoMode: false,
  }),
  'gateway'
);
expect(
  'B restart signed-out with stale complete still gateway',
  routing.resolveSessionDestination({
    signedIn: false,
    onboardingComplete: true,
    demoMode: false,
  }),
  'gateway'
);

// C. Explicit Try Demo
expect(
  'C demo mode opens tabs while signed out',
  routing.resolveSessionDestination({
    signedIn: false,
    onboardingComplete: true,
    demoMode: true,
  }),
  'tabs'
);
expect(
  'C demo from index replaces to tabs',
  routing.resolveRootRedirect({
    signedIn: false,
    onboardingComplete: true,
    demoMode: true,
    route: 'index',
  }).to,
  '/(tabs)'
);

// D/E authenticated paths
expect(
  'D signed-in complete goes to tabs',
  routing.resolveSessionDestination({
    signedIn: true,
    onboardingComplete: true,
    demoMode: false,
  }),
  'tabs'
);
expect(
  'D signed-in incomplete goes to onboarding',
  routing.resolveSessionDestination({
    signedIn: true,
    onboardingComplete: false,
    demoMode: false,
  }),
  'onboarding'
);

// F. No redirect loop on gateway surface
expect(
  'F signed-out already on index stays',
  routing.resolveRootRedirect({
    signedIn: false,
    onboardingComplete: false,
    demoMode: false,
    route: 'index',
  }).action,
  'none'
);
expect(
  'F signed-out on sign-in stays',
  routing.resolveRootRedirect({
    signedIn: false,
    onboardingComplete: true,
    demoMode: false,
    route: 'sign-in',
  }).action,
  'none'
);

const auth = read('src/auth/AuthContext.js');
const layout = read('src/app/_layout.js');
const index = read('src/app/index.js');
const profile = read('src/app/(tabs)/profile.js');
const tracking = read('src/tracking/TrackingContext.js');
const onboarding = read('src/app/onboarding.js');

expect('signOut clears React session before awaiting storage', /setSession\(null\);[\s\S]*signOut\(\{ scope: 'local' \}\)/.test(auth));
expect('signOut uses local scope', auth.includes("signOut({ scope: 'local' })"));
expect('signOut ignores re-auth during logout', auth.includes('signingOutRef') && auth.includes('auth_state_ignored_during_signout'));
expect('routing helper used by layout', layout.includes('resolveRootRedirect'));
expect('routing helper used by index', index.includes('resolveSessionDestination'));
expect('index no longer sends signed-out complete guests to tabs', !index.includes("reason: 'guest_complete'"));
expect(
  'profile uses in-app logout confirm not Alert',
  profile.includes('logoutConfirm')
    && profile.includes('[logout] button_pressed')
    && profile.includes("router.replace('/')")
    && !/confirm\(t\('profile\.logoutTitle'/.test(profile)
    && !/Alert\.alert\(\s*t\('profile\.logoutTitle'/.test(profile)
);
expect('profile hides development tools section', !profile.includes("profile.demoKicker") && !profile.includes("profile.traktTest") && !profile.includes('loadDemo'));
expect('profile logout is a settings row', profile.includes('log-out-outline') && profile.includes('logoutRow'));
expect('tracking marks guest fresh on logout user clear', tracking.includes('guestFreshRef.current = true') && tracking.includes('tracking_scope_updated'));
expect('onboarding checks signedOut before onboardingComplete', onboarding.indexOf('if (!signedIn)') < onboarding.indexOf('if (onboardingComplete)'));

const accountStore = loadModules(
  ['src/tracking/watchlistOrder.js', 'src/tracking/watchlistSort.js', 'src/tracking/watchlist.js', 'src/tracking/cloudState.js', 'src/tracking/accountStore.js'],
  'emptyGuestState, writeGuestSession, readGuestSession, markGuestFresh, isGuestFresh, GUEST_TRACKING_KEY, accountStorageKey'
);

const memory = new Map();
const storage = {
  async getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  async setItem(key, value) {
    memory.set(key, String(value));
  },
  async removeItem(key) {
    memory.delete(key);
  },
};

(async () => {
  memory.clear();
  const accountKey = accountStore.accountStorageKey('user-1');
  await storage.setItem(accountKey, JSON.stringify({
    state: {
      onboardingComplete: true,
      shows: { a: { intent: 'watching' } },
      movies: {},
      showRatings: {},
      episodeRatings: {},
      episodeMeta: {},
      keptEpisodes: {},
      activityEvents: [],
      demoMode: false,
    },
    server: {
      onboardingComplete: true,
      shows: {},
      movies: {},
      showRatings: {},
      episodeRatings: {},
      episodeMeta: {},
      keptEpisodes: {},
      activityEvents: [],
      demoMode: false,
    },
    stamps: { media: {}, episodes: {} },
  }));
  await storage.setItem(accountStore.GUEST_TRACKING_KEY, JSON.stringify({
    onboardingComplete: true,
    shows: { 'guest-show': { intent: 'watching' } },
    movies: {},
    showRatings: {},
    episodeRatings: {},
    episodeMeta: {},
    keptEpisodes: {},
    activityEvents: [],
    demoMode: false,
  }));

  await accountStore.markGuestFresh(storage);
  const freshGuest = await accountStore.readGuestSession(storage);
  expect('logout uses a clean guest session', freshGuest.onboardingComplete, false);
  expect('logout does not display archived guest shows', freshGuest.shows['guest-show'] == null, true);
  expect('logout does not delete account cloud cache envelope', Boolean(await storage.getItem(accountKey)));

  // Simulate routing after logout with stale complete flag still true.
  const afterLogout = routing.resolveSessionDestination({
    signedIn: false,
    onboardingComplete: true,
    demoMode: false,
  });
  expect('E account switch isolation uses gateway not prior tabs', afterLogout, 'gateway');

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
  console.log(`Logout checks passed (${checks.length})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
