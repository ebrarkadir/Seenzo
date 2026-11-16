begin;
select plan(18);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (user_id) do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_favorites'::regclass),
  'profile_favorites has row level security'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select * from public.set_profile_favorites(
    'show',
    '[{"media_id":"trakt-show-1","position":1},{"media_id":"trakt-show-2","position":2}]'::jsonb
  )$$,
  'owner can set show favorites'
);

select results_eq(
  $$select count(*)::int from public.profile_favorites where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[2],
  'owner favorites persist'
);

select throws_ok(
  $$select * from public.set_profile_favorites(
    'show',
    '[{"media_id":"trakt-show-1","position":1},{"media_id":"trakt-show-2","position":2},{"media_id":"trakt-show-3","position":3},{"media_id":"trakt-show-4","position":4},{"media_id":"trakt-show-5","position":1}]'::jsonb
  )$$,
  'P0001',
  'favorites_limit',
  'fifth favorite is rejected by backend'
);

select throws_ok(
  $$select * from public.set_profile_favorites(
    'show',
    '[{"media_id":"trakt-show-1","position":1},{"media_id":"trakt-show-1","position":2}]'::jsonb
  )$$,
  'P0001',
  'duplicate_media',
  'duplicate media in one type is rejected'
);

select throws_ok(
  $$insert into public.profile_favorites (user_id, media_type, media_id, position)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'movie', 'trakt-movie-9', 1)$$,
  '42501',
  null,
  'owner cannot insert favorites for another user'
);

select results_eq(
  $$select count(*)::int from public.profile_favorites where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[0],
  'owner cannot read other user favorites'
);

update public.profiles
set username = 'alpha_one', display_name = 'Alpha'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select throws_ok(
  $$update public.profiles
    set username = 'alpha_one'
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '23505',
  null,
  'username uniqueness is case-preserving and unique'
);

select throws_ok(
  $$update public.profiles
    set user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501',
  null,
  'user cannot transfer profile ownership'
);

select ok(
  exists(select 1 from storage.buckets where id = 'profile-media' and public = false),
  'profile-media bucket exists and is private'
);

select * from finish();
rollback;
