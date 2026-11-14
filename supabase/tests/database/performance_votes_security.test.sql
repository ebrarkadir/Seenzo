begin;
select plan(18);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voter@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'other@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (user_id) do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.performance_votes'::regclass),
  'performance_votes has row level security'
);

select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.performance_votes', 'INSERT')
  $$,
  array[false],
  'authenticated cannot insert performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.performance_votes', 'UPDATE')
  $$,
  array[false],
  'authenticated cannot update performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.performance_votes', 'DELETE')
  $$,
  array[false],
  'authenticated cannot delete performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.performance_votes', 'SELECT')
  $$,
  array[false],
  'authenticated cannot select raw performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('anon', 'public.performance_votes', 'INSERT')
  $$,
  array[false],
  'anon cannot insert performance_votes'
);

set local role anon;
select throws_ok(
  $$
    insert into public.performance_votes (
      user_id, show_trakt_id, season_number, episode_number, person_trakt_id
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1390, 1, 1, 11
    )
  $$,
  '42501',
  null,
  'unauthenticated vote insert is rejected'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok(
  $$
    insert into public.performance_votes (
      user_id, show_trakt_id, season_number, episode_number, person_trakt_id
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1390, 1, 1, 11
    )
  $$,
  '42501',
  null,
  'authenticated client cannot bypass Edge Function with direct insert'
);

select throws_ok(
  $$
    update public.performance_votes
    set person_trakt_id = 99
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  $$,
  '42501',
  null,
  'authenticated client cannot update another users votes'
);

reset role;

insert into public.performance_votes (
  user_id, show_trakt_id, season_number, episode_number, person_trakt_id
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1390, 1, 1, 11),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1390, 1, 1, 22);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select results_eq(
  $$
    select person_trakt_id, vote_count, total_votes, my_person_trakt_id
    from public.performance_vote_stats(1390, 1, 1)
    order by person_trakt_id
  $$,
  $$
    values
      (11::bigint, 1::bigint, 2::bigint, 11::bigint),
      (22::bigint, 1::bigint, 2::bigint, 11::bigint)
  $$,
  'aggregate stats return counts without exposing other user ids'
);

select results_eq(
  $$
    select count(*)::int
    from public.performance_vote_stats(1390, 1, 2)
  $$,
  array[1],
  'zero-vote episode returns a single aggregate row'
);

select results_eq(
  $$
    select coalesce(person_trakt_id, -1), vote_count, total_votes, coalesce(my_person_trakt_id, -1)
    from public.performance_vote_stats(1390, 1, 2)
  $$,
  $$
    values (-1::bigint, null::bigint, 0::bigint, -1::bigint)
  $$,
  'zero votes expose total_votes = 0 and no person counts'
);

-- Simulate a second vote for the same user/episode (unique upsert behavior).
reset role;
update public.performance_votes
set person_trakt_id = 55
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and show_trakt_id = 1390
  and season_number = 1
  and episode_number = 1;

select results_eq(
  $$
    select count(*)::int
    from public.performance_votes
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and show_trakt_id = 1390
      and season_number = 1
      and episode_number = 1
  $$,
  array[1],
  'second vote updates the existing row rather than creating a duplicate'
);

select results_eq(
  $$
    select person_trakt_id
    from public.performance_votes
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and show_trakt_id = 1390
      and season_number = 1
      and episode_number = 1
  $$,
  array[55::bigint],
  'second vote replaces the selected actor'
);

-- Watched-episode prerequisite is enforced by the Edge Function against episode_entries.
insert into public.episode_entries (
  user_id, show_media_id, episode_id, season_number, episode_number, watched, rating
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'trakt-show-1390',
  'trakt-episode-9001',
  1,
  1,
  true,
  null
);

select results_eq(
  $$
    select watched
    from public.episode_entries
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and show_media_id = 'trakt-show-1390'
      and season_number = 1
      and episode_number = 1
  $$,
  array[true],
  'watched episode row exists for Edge Function validation'
);

select results_eq(
  $$
    select count(*)::int
    from public.episode_entries
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and show_media_id = 'trakt-show-1390'
      and season_number = 1
      and episode_number = 9
      and watched = true
  $$,
  array[0],
  'unwatched episode has no watched row for vote validation'
);

select ok(
  position('count(*)' in pg_get_functiondef('public.performance_vote_stats(bigint,integer,integer)'::regprocedure)) > 0,
  'stats function uses valid count(*) syntax'
);

select * from finish();
rollback;
