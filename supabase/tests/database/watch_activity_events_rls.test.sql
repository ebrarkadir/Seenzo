begin;
select plan(8);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com')
on conflict (id) do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.watch_activity_events'::regclass),
  'watch_activity_events has row level security'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$insert into public.watch_activity_events (
      user_id, client_event_id, media_type, media_id, action, source, client_logged_at
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      'movie',
      'trakt-movie-1',
      'watched',
      'individual',
      '2020-01-01T00:00:00Z'
    )$$,
  'owner can insert activity without server timestamp columns'
);

select results_eq(
  $$select (server_recorded_at >= now() - interval '1 minute')::int
    from public.watch_activity_events
    where client_event_id = '11111111-1111-1111-1111-111111111111'$$,
  array[1],
  'server_recorded_at is recent and server-authored'
);

-- Column-level INSERT privilege should reject forged server_recorded_at.
select throws_ok(
  $$insert into public.watch_activity_events (
      user_id, client_event_id, media_type, media_id, action, source,
      client_logged_at, server_recorded_at
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '22222222-2222-2222-2222-222222222222',
      'movie',
      'trakt-movie-2',
      'watched',
      'individual',
      '2020-01-01T00:00:00Z',
      '2015-01-01T00:00:00Z'
    )$$,
  '42501',
  null,
  'authenticated cannot insert forged server_recorded_at'
);

select throws_ok(
  $$insert into public.watch_activity_events (
      user_id, client_event_id, media_type, media_id, action, source, client_logged_at
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '33333333-3333-3333-3333-333333333333',
      'movie',
      'trakt-movie-3',
      'watched',
      'individual',
      now()
    )$$,
  '42501',
  null,
  'owner cannot insert activity for another user'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.watch_activity_events
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'other users cannot read foreign activity events'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select throws_ok(
  $$update public.watch_activity_events
    set server_recorded_at = '2015-01-01T00:00:00Z'
    where client_event_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'authenticated cannot update activity timestamps'
);

select throws_ok(
  $$delete from public.watch_activity_events
    where client_event_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'authenticated cannot delete activity events'
);

select * from finish();
rollback;
