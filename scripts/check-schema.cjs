const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261114153000_create_tracking_schema.sql'),
  'utf8'
);
const test = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'tests', 'database', 'tracking_rls.test.sql'),
  'utf8'
);
const lowered = migration.toLowerCase();

const checks = [];
function expect(name, actual, expected) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

['public.profiles', 'public.media_entries', 'public.episode_entries'].forEach((table) => {
  expect(`${table} is created`, migration.includes(`create table ${table}`), true);
  expect(`${table} enables rls`, lowered.includes(`alter table ${table} enable row level security`), true);
  expect(`${table} is revoked from anon`, lowered.includes(`revoke all on table ${table} from public, anon`), true);
});

['profiles', 'media_entries', 'episode_entries'].forEach((table) => {
  ['select', 'insert', 'update', 'delete'].forEach((action) => {
    expect(`${table} has ${action} policy`, lowered.includes(`create policy ${table}_${action}_own`), true);
  });
});

expect(
  'inserts and updates keep the row owner',
  migration.split('with check ((select auth.uid()) = user_id)').length - 1,
  6
);
expect('statuses exclude caught up and completed', migration.includes("show_intent in ('plan', 'watching', 'dropped')"), true);
expect('ratings are limited to 1 through 10', migration.includes('rating between 1 and 10'), true);
expect('show ids are provider qualified', migration.includes("^trakt-show-[0-9]+$"), true);
expect('movie ids are provider qualified', migration.includes("^trakt-movie-[0-9]+$"), true);
expect('episode ids are provider qualified', migration.includes("^trakt-episode-[0-9]+$"), true);
expect('one media row per user and title id', migration.includes('unique (user_id, media_id)'), true);
expect('one episode row per user and episode id', migration.includes('unique (user_id, episode_id)'), true);
expect('migration does not drop tables', lowered.includes('drop table'), false);
expect('migration has no markdown escapes', /\\~|new\\\.id/.test(migration), false);
expect('existing users are backfilled', migration.includes('on conflict (user_id) do nothing'), true);
expect('episodes do not reference media rows', /episode_entries[\s\S]*references public\.media_entries/i.test(migration), false);
expect('migration does not embed a secret key', /service_role_key|sb_secret/i.test(migration), false);
expect('tests cover anonymous denial', test.includes('anonymous users cannot read media tracking'), true);
expect('tests cover cross-user reads', test.includes('user B cannot read user A media'), true);
expect('tests cover ownership transfer', test.includes('user A cannot transfer a profile'), true);
expect('tests cover duplicate episodes', test.includes('duplicate episode ids are rejected'), true);
expect('tests cover invalid ratings', test.includes('a rating above 10 is rejected'), true);

const assertions = test.split('\n').filter((line) => /^select (ok|throws_ok|results_eq|is_empty)\(/.test(line)).length;
expect('pgTAP plan matches assertions', test.includes(`select plan(${assertions})`), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Schema checks passed (${checks.length})`);
