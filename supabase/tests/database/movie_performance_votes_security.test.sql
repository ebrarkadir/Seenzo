begin;
select plan(16);

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
  (select relrowsecurity from pg_class where oid = 'public.movie_performance_votes'::regclass),
  'movie_performance_votes has row level security'
);

select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.movie_performance_votes', 'INSERT')
  $$,
  array[false],
  'authenticated cannot insert movie_performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.movie_performance_votes', 'UPDATE')
  $$,
  array[false],
  'authenticated cannot update movie_performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.movie_performance_votes', 'DELETE')
  $$,
  array[false],
  'authenticated cannot delete movie_performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('authenticated', 'public.movie_performance_votes', 'SELECT')
  $$,
  array[false],
  'authenticated cannot select raw movie_performance_votes'
);
select results_eq(
  $$
    select has_table_privilege('anon', 'public.movie_performance_votes', 'INSERT')
  $$,
  array[false],
  'anon cannot insert movie_performance_votes'
);

set local role anon;
select throws_ok(
  $$
    insert into public.movie_performance_votes (
      user_id, movie_trakt_id, person_trakt_id
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 11
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
    insert into public.movie_performance_votes (
      user_id, movie_trakt_id, person_trakt_id
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 11
    )
  $$,
  '42501',
  null,
  'authenticated client cannot bypass Edge Function'
);

reset role;

insert into public.movie_performance_votes (user_id, movie_trakt_id, person_trakt_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 11),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 22);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok(
  $$
    update public.movie_performance_votes
    set person_trakt_id = 99
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  $$,
  '42501',
  null,
  'cannot update another users votes'
);

select results_eq(
  $$
    select person_trakt_id::int, vote_count::int, total_votes::int
    from public.movie_performance_vote_stats(1)
    order by person_trakt_id
  $$,
  $$
    values (11, 1, 2), (22, 1, 2)
  $$,
  'aggregate stats return counts'
);

select results_eq(
  $$
    select my_person_trakt_id::int
    from public.movie_performance_vote_stats(1)
    limit 1
  $$,
  array[11],
  'stats expose only the caller vote identity'
);

reset role;

-- service_role style second vote update (Edge Function path)
update public.movie_performance_votes
set person_trakt_id = 33
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and movie_trakt_id = 1;

select results_eq(
  $$
    select person_trakt_id
    from public.movie_performance_votes
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and movie_trakt_id = 1
  $$,
  array[33::bigint],
  'second vote updates the existing row'
);

select isnt(
  (select to_regclass('public.performance_votes')),
  null::regclass,
  'episode performance_votes table remains available'
);

select finish();
rollback;
