const fs = require('fs');
const path = require('path');

function loadModule(relativePath, returned) {
  const file = path.join(__dirname, '..', relativePath);
  const code = fs.readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  return new Function(`${code}\nreturn { ${returned} };`)();
}

const config = loadModule(
  'src/services/supabase/config.js',
  'inspectSupabaseConfig, SUPABASE_URL_PLACEHOLDER, SUPABASE_KEY_PLACEHOLDER'
);
const messages = loadModule('src/auth/messages.js', 'validateEmail, validatePassword, authErrorMessage, isEmailAddressInvalid');

const checks = [];
function expect(name, actual, expected) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

expect('missing config', config.inspectSupabaseConfig('', ''), { ready: false, reason: 'missing' });
expect(
  'placeholder config',
  config.inspectSupabaseConfig(config.SUPABASE_URL_PLACEHOLDER, config.SUPABASE_KEY_PLACEHOLDER),
  { ready: false, reason: 'placeholder' }
);
expect('http url is rejected', config.inspectSupabaseConfig('http://example.supabase.co', 'sb_publishable_test'), { ready: false, reason: 'invalidUrl' });
expect('secret key is rejected', config.inspectSupabaseConfig('https://example.supabase.co', 'sb_secret_test'), { ready: false, reason: 'unsafe' });
expect('service role key is rejected', config.inspectSupabaseConfig('https://example.supabase.co', 'service_role_key'), { ready: false, reason: 'unsafe' });
expect('publishable config is ready', config.inspectSupabaseConfig('https://example.supabase.co', 'sb_publishable_test'), { ready: true, reason: 'ready' });
expect('email requires a domain', messages.validateEmail('person@example.com'), true);
expect('email trims surrounding spaces', messages.validateEmail('  person@example.com  '), true);
expect('email allows a plus address', messages.validateEmail('person+tag@example.co.uk'), true);
expect('email rejects a name only', messages.validateEmail('person'), false);
expect('email rejects a missing top-level domain', messages.validateEmail('person@example'), false);
expect('email rejects a one-letter top-level domain', messages.validateEmail('person@example.c'), false);
expect('email rejects consecutive dots', messages.validateEmail('person..name@example.com'), false);
expect('short password is rejected', messages.validatePassword('12345'), false);
expect('six character password is accepted', messages.validatePassword('123456'), true);

const t = (key) => key;
expect('invalid email code maps to a translation', messages.authErrorMessage(t, { code: 'email_address_invalid', message: 'Email address "a@b" is invalid' }), 'auth.errors.emailInvalid');
expect('invalid email message is recognized', messages.isEmailAddressInvalid({ message: 'Email address "a@b" is invalid' }), true);
expect('invalid login maps to a translation', messages.authErrorMessage(t, { message: 'Invalid login credentials' }), 'auth.errors.invalid');
expect('unconfirmed email maps to a translation', messages.authErrorMessage(t, { message: 'Email not confirmed' }), 'auth.errors.unconfirmed');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
expect('env keeps the trakt variable', env.includes('EXPO_PUBLIC_TRAKT_CLIENT_ID='), true);
expect('env uses the expo supabase url', env.includes('EXPO_PUBLIC_SUPABASE_URL='), true);
expect('env uses the expo publishable key', env.includes('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='), true);
expect('env does not use next public names', env.includes('NEXT_PUBLIC_'), false);
const signInSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/sign-in.js'), 'utf8');
const signUpSource = fs.readFileSync(path.join(__dirname, '..', 'src/app/sign-up.js'), 'utf8');
expect('sign in opens the sign up route', signInSource.includes("router.push('/sign-up')"), true);
expect(
  'create account navigation is not disabled by config',
  /createAccount'\)\} variant="secondary" onPress=\{\(\) => router\.push\('\/sign-up'\)\}/.test(signInSource),
  true
);
expect('sign up sends the trimmed email', signUpSource.includes('signUp(trimmedEmail, password)'), true);
expect('sign in sends the trimmed email', signInSource.includes('signIn(trimmedEmail, password)'), true);
expect('gitignore ignores local env files', fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').includes('.env*.local'), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Auth checks passed (${checks.length})`);
