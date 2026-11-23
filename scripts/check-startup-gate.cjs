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

const layout = read('src/app/_layout.js');
const tracking = read('src/tracking/TrackingContext.js');
const sync = read('src/services/supabase/trackingSync.js');
const auth = read('src/auth/AuthContext.js');
const en = JSON.parse(read('src/i18n/locales/en.json'));

expect('boot gate shows visible loading UI', layout.includes('ActivityIndicator') && layout.includes('sync.loading'));
expect('boot gate is not a blank-only view', !/if \(!authReady \|\| !ready \|\| !catalogReady\) \{\s*return <View style=\{\{ flex: 1, backgroundColor: colors\.background \}\} \/>;/.test(layout));
expect('tracking load has timeout', tracking.includes('ACCOUNT_LOAD_TIMEOUT_MS') && tracking.includes('withTimeout'));
expect('tracking auth mismatch no longer silent-returns', tracking.includes("throw new Error('auth')"));
expect('tracking always reaches setReady on load error', tracking.includes('setReady(true)'));
expect('pull prefers getSession', sync.includes('auth.getSession()') && sync.includes('auth.getUser()'));
expect('auth client init failures still mark ready', auth.includes('auth_client_failed') && auth.includes('setReady(true)'));
expect('startup diagnostics omit secrets', !/access_token|password|EXPO_PUBLIC_/.test(read('src/diagnostics/startup.js')));
expect('sync loading copy exists', Boolean(en.sync.loading));

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Startup gate checks passed (${checks.length})`);
