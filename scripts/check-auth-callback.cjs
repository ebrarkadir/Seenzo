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

const callbackRoute = read('src/app/auth/callback.js');
const authCallback = read('src/auth/authCallback.js');
const client = read('src/services/supabase/client.js');
const webCrypto = read('src/services/supabase/webCrypto.js');
const layout = read('src/app/_layout.js');
const index = read('src/app/index.js');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const pkg = JSON.parse(read('package.json'));

expect('expo-crypto dependency present', Boolean(pkg.dependencies['expo-crypto']));
expect('client imports webCrypto helper', client.includes("from './webCrypto'"));
expect(
  'client asserts pkce crypto before createClient call',
  client.indexOf('ensurePkceWebCrypto()') >= 0
    && client.indexOf('ensurePkceWebCrypto()') < client.indexOf('createClient(')
);
expect('client keeps pkce flow', client.includes("flowType: 'pkce'"));
expect('client does not switch to implicit', !client.includes("flowType: 'implicit'"));
expect('webCrypto installs subtle.digest', webCrypto.includes('subtle') && webCrypto.includes('digest'));
expect('webCrypto uses expo-crypto digest', webCrypto.includes('ExpoCrypto.digest'));
expect('webCrypto refuses missing S256 surfaces', webCrypto.includes('PKCE S256 WebCrypto surfaces are unavailable'));

const helpers = loadModules(
  ['src/auth/authRedirect.js', 'src/auth/authCallback.js'],
  'parseAuthCallbackParams, mapAuthCallbackError, PKCE_FLOW_ID_PARAM, resetAuthCallbackProcessingForTests'
);
helpers.resetAuthCallbackProcessingForTests();

expect('flow id param name', helpers.PKCE_FLOW_ID_PARAM, 'sb_flow_id');
expect(
  'parses pkce code and flow id',
  helpers.parseAuthCallbackParams('seenzo://auth/callback?code=abc&sb_flow_id=flow123'),
  { code: 'abc', sb_flow_id: 'flow123' }
);
expect('maps pkce verifier errors', helpers.mapAuthCallbackError({}, { message: 'PKCE code verifier not found in storage' }).code, 'link_device_mismatch');
expect('maps timeout errors', helpers.mapAuthCallbackError({}, { code: 'link_timeout' }).code, 'link_timeout');
expect('exchange uses timeout', authCallback.includes('EXCHANGE_TIMEOUT_MS') && authCallback.includes('withTimeout'));
expect('exchange passes flow id', authCallback.includes('exchangeCodeForSession') && authCallback.includes('flowId'));
expect('duplicate recovers existing session', authCallback.includes("status: 'ok'") && authCallback.includes('duplicate: true'));
expect('callback has loading timeout', callbackRoute.includes('RESOLVE_TIMEOUT_MS') && callbackRoute.includes('link_timeout'));
expect('callback success ignores effect cancellation', callbackRoute.includes('finishSuccess') && callbackRoute.includes('finishedRef'));
expect('callback waits when url missing', callbackRoute.includes('if (!url)') && callbackRoute.includes('return;'));
expect('callback never logs secrets', !/console\.(log|info|debug|warn)/i.test(callbackRoute) && !/console\.(log|info|debug|warn)/i.test(authCallback));
expect('callback error offers sign-in', callbackRoute.includes("router.replace('/sign-in')"));
expect('layout keeps auth route while confirming', layout.includes("route !== 'auth'"));
// Guests render AuthGateway in place; new accounts navigate via router.replace.
// Do not revive expo-router Redirect as the entry cover (Android Fabric overlay).
expect(
  'index still routes new accounts to onboarding',
  index.includes("router.replace('/onboarding')")
    && !/from ['\"]expo-router['\"]/.test(index.split('\n').filter((line) => line.includes('Redirect')).join('\n') || '')
    && !/<Redirect\b/.test(index)
);
expect(
  'index still routes guests to welcome gateway',
  index.includes('AuthGateway')
    && index.includes("branch: 'gateway'")
    && !index.includes("router.replace('/welcome')")
    && !index.includes('href="/welcome"')
);
expect('i18n timeout message', Boolean(en.auth.errors.link_timeout));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Auth callback checks passed (${checks.length})`);
