-- Social V5 profile reviews / friends ratings / filtered feed (pgTAP).
-- Run manually after applying 20261126200000_social_v5_*.sql (and V3 reviews deps).
begin;
select plan(16);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma@example.com')
on conflict (id) do nothing;

insert into public.profiles (
  user_id, username, display_name, is_public, allow_profile_discovery, share_activity_with_followers
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, true, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, true, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', true, true, false)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

reset role;
select public.social_upsert_activity_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-501',
  null, null, null, 9,
  'aaaaaaaa-1111-1111-1111-111111111111'::uuid,
  true
);

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-501',
  'Alpha shared review',
  false
) on conflict do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-502',
  'Alpha private-only review',
  false
) on conflict do nothing;

insert into public.media_entries (
  user_id, media_type, media_id, movie_saved, movie_watched, rating
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-501',
  true,
  true,
  9
) on conflict do nothing;

-- Beta follows alpha.
insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

-- Pending request from gamma is not enough.
delete from public.profile_follow_requests
where requester_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
insert into public.profile_follow_requests (requester_id, target_id, status)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'pending'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*)::integer from public.list_profile_reviews('alpha_one', 'all', 20, null, null)),
  1,
  'follower sees only published shared reviews'
);

select ok(
  (select bool_and(is_published) from public.list_profile_reviews('alpha_one', 'all', 20, null, null)),
  'follower rows are published'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select ok(
  (select count(*)::integer from public.list_profile_reviews('alpha_one', 'all', 20, null, null)) >= 2,
  'owner sees private and published reviews'
);

select ok(
  (select count(*)::integer
     from public.list_profile_reviews('alpha_one', 'all', 20, null, null)
    where is_published = false) >= 1,
  'owner private reviews stay marked unpublished'
);

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(
  (select count(*)::integer from public.list_profile_reviews('alpha_one', 'all', 20, null, null)),
  0,
  'pending follow request cannot list profile reviews'
);

-- Friends ratings
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (public.get_friends_media_ratings('movie', 'trakt-movie-501', 5, 0)->>'rating_count')::integer,
  1,
  'friends ratings count includes followed sharer'
);

select is(
  (public.get_friends_media_ratings('movie', 'trakt-movie-501', 5, 0)->>'average')::numeric,
  9.0,
  'friends ratings average is real'
);

select is(
  public.get_friends_media_ratings('movie', 'trakt-movie-999', 5, 0)->>'average',
  null,
  'zero friends ratings yields null average'
);

-- Filtered feed
select ok(
  (select count(*)::integer
     from public.list_following_activity_filtered('reviews', 20, null, null)) >= 1,
  'reviews filter returns shared review activities'
);

select is(
  (select count(*)::integer
     from public.list_following_activity_filtered('watched', 20, null, null)
    where activity_type like '%_rated'),
  0,
  'watched filter excludes rating events'
);

-- Sharing OFF hides reviews for followers
reset role;
update public.profiles
set share_activity_with_followers = false
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*)::integer from public.list_profile_reviews('alpha_one', 'all', 20, null, null)),
  0,
  'sharing off hides profile reviews from followers'
);

select is(
  (public.get_friends_media_ratings('movie', 'trakt-movie-501', 5, 0)->>'rating_count')::integer,
  0,
  'sharing off hides friends ratings'
);

-- Unfollow revocation
reset role;
update public.profiles
set share_activity_with_followers = true
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.profile_follows
where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*)::integer from public.list_profile_reviews('alpha_one', 'all', 20, null, null)),
  0,
  'unfollow revokes profile review access'
);

-- Anonymous denial
reset role;
set local role anon;

select throws_ok(
  $$select public.list_profile_reviews('alpha_one', 'all', 20, null, null)$$,
  'P0001',
  'unauthenticated',
  'anonymous cannot list profile reviews'
);

select throws_ok(
  $$select public.get_friends_media_ratings('movie', 'trakt-movie-501', 5, 0)$$,
  'P0001',
  'unauthenticated',
  'anonymous cannot read friends ratings'
);

select throws_ok(
  $$select public.list_following_activity_filtered('all', 20, null, null)$$,
  'P0001',
  'unauthenticated',
  'anonymous cannot read filtered feed'
);

select * from finish();
rollback;
