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

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const welcome = read('src/app/welcome.js');
const index = read('src/app/index.js');
const gateway = read('src/components/auth/AuthGateway.js');
const layout = read('src/app/_layout.js');
const onboarding = read('src/app/onboarding.js');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const sync = read('src/tracking/cloudState.js');
const deeplink = read('scripts/check-auth-deeplink.cjs');

expect('auth gateway component exists', gateway.includes('authGateway.title') && gateway.includes("router.push('/sign-in')"));
expect('gateway offers create account', gateway.includes("router.push('/sign-up')"));
expect('gateway offers try demo', gateway.includes('loadDemo') && gateway.includes('onboarding.tryDemo'));
expect('gateway has no get started', !gateway.includes('onboarding.getStarted') && !gateway.includes('getStarted'));
expect('index renders gateway for guests', index.includes('AuthGateway') && index.includes("branch: 'gateway'"));
expect('index never returns null', !/return null/.test(index));
expect('index never uses Redirect cover', !index.includes('Redirect'));
expect('index uses session routing helper', index.includes('resolveSessionDestination'));
expect('index sends incomplete signed-in to onboarding', index.includes("router.replace('/onboarding')"));
expect('index sends tabs only via destination tabs', index.includes("destination === 'tabs'") && index.includes("router.replace('/(tabs)')"));
expect('layout registers welcome screen', layout.includes('name="welcome"'));
expect('layout uses root redirect helper', layout.includes('resolveRootRedirect'));
expect(
  'layout prefers index for signed-out',
  layout.includes('resolveRootRedirect')
    && read('src/auth/sessionRouting.js').includes("to: '/'")
    && read('src/auth/sessionRouting.js').includes('signed_out_to_gateway')
);
expect('layout redirects signed-in incomplete via helper', read('src/auth/sessionRouting.js').includes("to: '/onboarding'"));
expect('onboarding welcome has get started', onboarding.includes('onboarding.getStarted'));
expect('onboarding welcome has no try demo button', !/WelcomeStep[\s\S]*tryDemo/.test(onboarding) && !onboarding.includes('onDemo'));
expect('onboarding redirects signed-out users to welcome or index', onboarding.includes("router.replace('/welcome')") || onboarding.includes("router.replace('/')"));
expect('auth gateway i18n keys exist', Boolean(en.authGateway?.title && en.authGateway?.body));
expect('onboarding complete still derived from account/cache state', sync.includes('cache.state.onboardingComplete') && sync.includes('remoteHasRows'));
expect('email callback flow checks remain', deeplink.includes('seenzo://auth/callback'));
expect('welcome route collapses onto index', welcome.includes("router.replace('/')"));
expect('welcome uses session routing helper', welcome.includes('resolveSessionDestination'));
expect('welcome does not send signed-out complete users to tabs', !/if \(onboardingComplete\) \{\s*router\.replace\('\/\(tabs\)'\)/.test(welcome));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Auth gateway checks passed (${checks.length})`);
