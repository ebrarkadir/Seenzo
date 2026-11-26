begin;
select plan(19);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id, username, display_name, is_public)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', true)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_follows'::regclass),
  'profile_follows has row level security'
);

select ok(
  (select is_public = false from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'alpha remains private by default fixture'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select results_eq(
  $$select count(*)::int from public.profiles where is_public = true and username = 'beta_two'$$,
  array[1],
  'authenticated user can read public profiles'
);

select results_eq(
  $$select count(*)::int from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and is_public = false$$,
  array[1],
  'owner can still read own private profile'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'other users cannot discover private profiles'
);

select lives_ok(
  $$insert into public.profile_follows (follower_id, following_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'user can follow a public profile'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  array[1],
  'follower can read own outgoing follow edge'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select results_eq(
  $$select count(*)::int from public.profile_follows
    where following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  array[0],
  'unrelated users cannot read other follow edges'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$insert into public.profile_follows (follower_id, following_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501',
  null,
  'self-follow is rejected'
);

select throws_ok(
  $$insert into public.profile_follows (follower_id, following_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501',
  null,
  'cannot follow a private profile'
);

select throws_ok(
  $$insert into public.profile_follows (follower_id, following_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501',
  null,
  'cannot insert a follow row as another user'
);

select throws_ok(
  $$insert into public.profile_follows (follower_id, following_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '23505',
  null,
  'duplicate follow is rejected by primary key'
);

select lives_ok(
  $$select * from public.get_public_profile_stats('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'public stats rpc works for public profile'
);

select throws_ok(
  $$select * from public.get_public_profile_stats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'P0001',
  'profile_not_public',
  'private profile stats are blocked for other users'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select lives_ok(
  $$select * from public.get_public_profile_stats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'owner can read own aggregate stats even when private'
);

-- Prove followed user cannot remove someone else's follow while the edge still exists.
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select is_empty(
  $$delete from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    returning follower_id$$,
  'followed user delete attempt returns no rows under RLS'
);

reset role;
select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  array[1],
  'followed user cannot delete someone else follow edge'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select lives_ok(
  $$delete from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'user can unfollow'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select throws_ok(
  $$update public.profiles
    set is_public = true, username = null
    where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '23514',
  null,
  'public profile without username is rejected'
);

select * from finish();
rollback;
