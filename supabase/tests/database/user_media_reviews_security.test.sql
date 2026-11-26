-- Requires 20261124230000_user_media_reviews.sql (+ Social V3).
-- Not executed without a local/staging database.
begin;
select plan(9);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com')
on conflict (id) do nothing;

insert into public.profiles (
  user_id, username, display_name, is_public, allow_profile_discovery, share_activity_with_followers
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, false, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, false, true)
on conflict (user_id) do update
set share_activity_with_followers = excluded.share_activity_with_followers,
    username = excluded.username;

insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$insert into public.user_media_reviews (
      user_id, media_type, media_id, review_text, contains_spoilers
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'movie',
      'trakt-movie-77',
      'Unforgettable score.',
      false
    )$$,
  'owner can insert own review'
);

select throws_ok(
  $$insert into public.user_media_reviews (
      user_id, media_type, media_id, review_text, contains_spoilers
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'movie',
      'trakt-movie-88',
      'Forged',
      false
    )$$,
  '42501',
  null,
  'cannot insert review for another user'
);

select throws_ok(
  $$insert into public.user_media_reviews (
      user_id, media_type, media_id, review_text, contains_spoilers
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'movie',
      'trakt-movie-89',
      repeat('x', 501),
      false
    )$$,
  '23514',
  null,
  'rejects reviews over 500 characters'
);

reset role;
select public.social_upsert_activity_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-77',
  null, null, null, 9, null, true
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select results_eq(
  $$select review_text from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-77'$$,
  array['Unforgettable score.'],
  'follower sees review text when sharing on'
);

select results_eq(
  $$select count(*)::int from public.user_media_reviews
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'follower cannot select another users review table rows directly'
);

reset role;
update public.profiles
set share_activity_with_followers = false
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-77'$$,
  array[0],
  'sharing off hides rating and review from followers'
);

reset role;
update public.profiles
set share_activity_with_followers = true
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

update public.user_media_reviews
set contains_spoilers = true,
    review_text = 'Jon snow knows'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-77';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select review_contains_spoilers from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-77'$$,
  array[true],
  'spoiler flag projects through feed rpc'
);

select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-77'$$,
  array[1],
  'review edit does not duplicate activity rows'
);

reset role;
delete from public.user_media_reviews
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-77';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select review_text is null from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-77'$$,
  array[true],
  'removing review keeps rating activity without review text'
);

select * from finish();
rollback;
