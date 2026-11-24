begin;
select plan(18);

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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, false, false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, false, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', false, false, true)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

select ok(
  (select share_activity_with_followers = false
     from public.profiles
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'sharing defaults off for alpha fixture'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.social_activity_events'::regclass),
  'social_activity_events has RLS'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$insert into public.social_activity_events (
      actor_id, activity_type, media_type, media_id
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'movie_watched',
      'movie',
      'trakt-movie-1'
    )$$,
  '42501',
  null,
  'clients cannot insert social activity rows'
);

-- Follow relationship: beta follows alpha (sharing still off)
insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

-- Direct helper publish should no-op while sharing off (service path via SECURITY DEFINER as postgres in tests)
reset role;
select is(
  public.social_upsert_activity_event(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'movie_watched',
    'movie',
    'trakt-movie-42',
    null, null, null, null, null, true
  ),
  null,
  'sharing off blocks publish helper'
);

update public.profiles
set share_activity_with_followers = true
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select ok(
  public.social_upsert_activity_event(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'movie_watched',
    'movie',
    'trakt-movie-42',
    null, null, null, null,
    '11111111-1111-1111-1111-111111111111'::uuid,
    true
  ) is not null,
  'sharing on allows publish helper'
);

-- Idempotent re-publish keeps a single row
select public.social_upsert_activity_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_watched',
  'movie',
  'trakt-movie-42',
  null, null, null, null,
  '22222222-2222-2222-2222-222222222222'::uuid,
  true
);

select results_eq(
  $$select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and media_id = 'trakt-movie-42'$$,
  array[1],
  'duplicate movie_watched collapses to one row'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)$$,
  array[1],
  'follower sees activity when sharing on and follow exists'
);

-- Pending private request is not enough (gamma private, sharing on, no follow)
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
reset role;
insert into public.profile_follow_requests (requester_id, target_id, status)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'pending'
);
select public.social_upsert_activity_event(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'movie_watched',
  'movie',
  'trakt-movie-99',
  null, null, null, null, null, true
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-99'$$,
  array[0],
  'pending follow request does not grant activity access'
);

-- Approved follow grants access
reset role;
insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-99'$$,
  array[1],
  'approved follow can read private actor activity when sharing on'
);

-- Unfollow removes visibility
reset role;
delete from public.profile_follows
where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and following_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-99'$$,
  array[0],
  'unfollowing removes activity visibility'
);

-- Sharing off hides existing rows on read
reset role;
update public.profiles
set share_activity_with_followers = false
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where media_id = 'trakt-movie-42'$$,
  array[0],
  'disabling sharing hides existing activity from followers'
);

-- Rating publish is self-only
select lives_ok(
  $$select public.publish_social_rating_event(
      'movie_rated', 'trakt-movie-7', null, null, null, 8
    )$$,
  'caller can publish own rating event when sharing on'
);

reset role;
update public.profiles
set share_activity_with_followers = true
where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select lives_ok(
  $$select public.publish_social_rating_event(
      'movie_rated', 'trakt-movie-7', null, null, null, 8
    )$$,
  'self rating publish succeeds for sharing-enabled account'
);

select results_eq(
  $$select count(*)::int from public.social_activity_events
    where actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-7'$$,
  array[1],
  'rating publish stores one movie_rated row'
);

-- Rating edit does not create a second row
select public.publish_social_rating_event(
  'movie_rated', 'trakt-movie-7', null, null, null, 9
);

select results_eq(
  $$select count(*)::int from public.social_activity_events
    where actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-7'$$,
  array[1],
  'rating edits update in place without flooding'
);

select results_eq(
  $$select rating::text from public.social_activity_events
    where actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and media_id = 'trakt-movie-7'$$,
  array['9.0'::text],
  'rating edit updates stored value'
);

-- Individual watch trigger path
reset role;
insert into public.watch_activity_events (
  user_id, client_event_id, media_type, media_id, action, source, client_logged_at
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-3333-3333-3333-333333333333',
  'movie',
  'trakt-movie-55',
  'watched',
  'individual',
  now()
);

select results_eq(
  $$select count(*)::int from public.social_activity_events
    where actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and activity_type = 'movie_watched'
      and media_id = 'trakt-movie-55'$$,
  array[1],
  'individual watch activity inserts social movie_watched'
);

insert into public.watch_activity_events (
  user_id, client_event_id, media_type, media_id, action, source, client_logged_at
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '44444444-4444-4444-4444-444444444444',
  'movie',
  'trakt-movie-56',
  'watched',
  'season_bulk',
  now()
);

select results_eq(
  $$select count(*)::int from public.social_activity_events
    where actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and media_id = 'trakt-movie-56'$$,
  array[0],
  'bulk watch source does not publish social activity'
);

select * from finish();
rollback;
