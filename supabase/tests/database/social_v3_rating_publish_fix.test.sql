-- Requires Social V3 base + 20261124223000_social_activity_rating_publish_fix.sql
-- Not executed in CI without a local/staging database.
begin;
select plan(8);

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

-- Seed a watched movie row without rating (INSERT must not publish rating).
insert into public.media_entries (
  user_id, media_type, media_id, movie_saved, movie_watched, rating
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'movie', 'trakt-movie-501', false, true, null
)
on conflict (user_id, media_id) do update
set movie_watched = true, rating = null;

select is(
  (select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'),
  0,
  'inserting media_entries without rating change does not create rating activity'
);

-- UPDATE rating publishes once
update public.media_entries
set rating = 9
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-501';

select is(
  (select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'
      and rating = 9),
  1,
  'updating media rating publishes movie_rated'
);

-- Edit rating updates in place
update public.media_entries
set rating = 8
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-501';

select is(
  (select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'),
  1,
  'rating edit does not duplicate movie_rated rows'
);

select is(
  (select rating::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'),
  8,
  'rating edit updates stored social rating value'
);

-- Clear rating removes social card
update public.media_entries
set rating = null
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-501';

select is(
  (select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'),
  0,
  'clearing rating removes social rating activity'
);

-- Sharing off blocks tracking-trigger publish
update public.profiles
set share_activity_with_followers = false
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

update public.media_entries
set rating = 7
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and media_id = 'trakt-movie-501';

select is(
  (select count(*)::int from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and activity_type = 'movie_rated'
      and media_id = 'trakt-movie-501'),
  0,
  'sharing off blocks rating publish from tracking trigger'
);

-- Self RPC still available; no-ops when sharing off
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  public.publish_social_rating_event('movie_rated', 'trakt-movie-501', null, null, null, 7),
  null,
  'rpc returns null when sharing off'
);

reset role;
update public.profiles
set share_activity_with_followers = true
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select ok(
  public.publish_social_rating_event('movie_rated', 'trakt-movie-501', null, null, null, 7) is not null,
  'rpc publishes when sharing on'
);

select * from finish();
rollback;
