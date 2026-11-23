const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261116210000_create_watch_activity_events.sql'),
  'utf8'
);
const lowered = migration.toLowerCase();

const checks = [];
function expect(name, actual, expected = true) {
  checks.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual,
    expected,
  });
}

expect('creates watch_activity_events', migration.includes('create table public.watch_activity_events'), true);
expect('enables rls', lowered.includes('alter table public.watch_activity_events enable row level security'), true);
expect('revokes authenticated table insert', /revoke all on table public\.watch_activity_events from public, anon, authenticated/i.test(migration), true);
expect('column insert omits server_recorded_at', /grant insert \([\s\S]*client_logged_at[\s\S]*\) on table public\.watch_activity_events to authenticated/i.test(migration)
  && !/grant insert \([\s\S]*server_recorded_at[\s\S]*\) on table public\.watch_activity_events to authenticated/i.test(migration), true);
expect('force server time trigger', migration.includes('watch_activity_events_force_server_time'), true);
expect('select policy', migration.includes('watch_activity_events_select_own'), true);
expect('insert policy', migration.includes('watch_activity_events_insert_own'), true);
expect('no authenticated update grant', /grant[^;]*update[^;]*watch_activity_events[^;]*authenticated/i.test(migration), false);
expect('no authenticated delete grant', /grant[^;]*delete[^;]*watch_activity_events[^;]*authenticated/i.test(migration), false);
expect('idempotent client event id', migration.includes('unique (user_id, client_event_id)'), true);
expect('server_recorded_at default now', /server_recorded_at timestamptz not null default now\(\)/i.test(migration), true);
expect('source includes season_bulk', migration.includes("'season_bulk'"), true);
expect('source includes show_bulk', migration.includes("'show_bulk'"), true);
expect('no historical backfill insert', /insert into public\.(media_entries|episode_entries)/i.test(migration), false);
expect('no drop table', lowered.includes('drop table'), false);
expect('no service role key', /service_role_key|sb_secret/i.test(migration), false);

const sync = fs.readFileSync(path.join(__dirname, '..', 'src/services/supabase/trackingSync.js'), 'utf8');
const activity = fs.readFileSync(path.join(__dirname, '..', 'src/tracking/activityEvents.js'), 'utf8');
expect('client insert omits server_recorded_at', activity.includes('client_logged_at: event.clientLoggedAt')
  && !/activityRowFromEvent[\s\S]*server_recorded_at/.test(activity), true);
expect('push uses ignoreDuplicates', sync.includes("ignoreDuplicates: true"), true);

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log(`Activity schema checks passed (${checks.length})`);
