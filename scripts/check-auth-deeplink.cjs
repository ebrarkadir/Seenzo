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

const redirect = loadModules(
  ['src/auth/authRedirect.js'],
  'AUTH_SCHEME, AUTH_CALLBACK_PATH, getAuthEmailRedirectTo, isAuthCallbackUrl'
);

expect('scheme is seenzo', redirect.AUTH_SCHEME, 'seenzo');
expect('callback path', redirect.AUTH_CALLBACK_PATH, 'auth/callback');
expect('email redirect url', redirect.getAuthEmailRedirectTo(), 'seenzo://auth/callback');
expect('recognizes callback url', redirect.isAuthCallbackUrl('seenzo://auth/callback?code=abc'), true);
expect('rejects localhost', redirect.isAuthCallbackUrl('http://localhost:3000/auth/callback'), false);

const callback = loadModules(
  ['src/auth/authRedirect.js', 'src/auth/authCallback.js'],
  'parseAuthCallbackParams, mapAuthCallbackError, resetAuthCallbackProcessingForTests'
);

callback.resetAuthCallbackProcessingForTests();
expect(
  'parses query code',
  callback.parseAuthCallbackParams('seenzo://auth/callback?code=abc123&type=signup').code,
  'abc123'
);
expect(
  'parses hash tokens without exposing helpers',
  Boolean(callback.parseAuthCallbackParams('seenzo://auth/callback#access_token=tok&refresh_token=ref').access_token),
  true
);
expect(
  'maps expired error',
  callback.mapAuthCallbackError({ error: 'otp_expired' }).code,
  'link_expired'
);

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
expect('app.json scheme seenzo', appJson.expo.scheme, 'seenzo');

const client = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/client.js'), 'utf8');
expect('client uses pkce', client.includes("flowType: 'pkce'"));
expect('client keeps detectSessionInUrl false', client.includes('detectSessionInUrl: false'));
expect('client installs webCrypto before supabase', client.includes("from './webCrypto'"));

const authContext = fs.readFileSync(path.join(__dirname, '..', 'src/auth/AuthContext.js'), 'utf8');
expect('signUp sets emailRedirectTo', authContext.includes('emailRedirectTo: getAuthEmailRedirectTo()'));
expect('resend uses signup type and redirect', authContext.includes("type: 'signup'") && authContext.includes('emailRedirectTo: getAuthEmailRedirectTo()'));
expect('no localhost redirect', !authContext.includes('localhost:3000'));

const callbackRoute = fs.readFileSync(path.join(__dirname, '..', 'src/app/auth/callback.js'), 'utf8');
expect('callback route exists and processes once', callbackRoute.includes('completeAuthCallbackFromUrl') && callbackRoute.includes('handledKey'));
expect('callback never logs tokens', !/console\.(log|info|debug|warn).*token|console\.(log|info|debug).*url/i.test(callbackRoute));
expect('callback navigates home', callbackRoute.includes("router.replace('/')"));
expect('callback has failure timeout', callbackRoute.includes('link_timeout'));

const signUp = fs.readFileSync(path.join(__dirname, '..', 'src/app/sign-up.js'), 'utf8');
const signIn = fs.readFileSync(path.join(__dirname, '..', 'src/app/sign-in.js'), 'utf8');
expect('sign-up has resend', signUp.includes('resendConfirmation') && signUp.includes('auth.resendConfirmation'));
expect('sign-in has unconfirmed resend', signIn.includes('needsConfirmation') && signIn.includes('resendConfirmation'));
expect('auth success uses index gate', signUp.includes("router.replace('/')") && signIn.includes("router.replace('/')"));

const layout = fs.readFileSync(path.join(__dirname, '..', 'src/app/_layout.js'), 'utf8');
expect('layout allows auth callback while onboarding incomplete', layout.includes("route !== 'auth'"));
expect('layout registers callback screen', layout.includes('auth/callback'));
expect('layout registers signed-out welcome gateway', layout.includes('name="welcome"'));

const en = fs.readFileSync(path.join(__dirname, '..', 'src/i18n/locales/en.json'), 'utf8');
expect('i18n has resend and link errors', en.includes('resendConfirmation') && en.includes('link_expired') && en.includes('link_device_mismatch') && en.includes('link_timeout'));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Auth deeplink checks passed (${checks.length})`);
