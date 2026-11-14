begin;
select plan(42);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');

select results_eq(
  $$select count(*)::int from public.profiles$$,
  array[2],
  'new auth users receive a profile'
);
delete from public.profiles where user_id = '22222222-2222-2222-2222-222222222222';
insert into public.profiles (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;
select results_eq(
  $$select count(*)::int from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'$$,
  array[1],
  'backfill creates a profile for an existing auth user'
);
update public.profiles
set display_name = 'Keep'
where user_id = '22222222-2222-2222-2222-222222222222';
insert into public.profiles (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;
select results_eq(
  $$select display_name from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'$$,
  array['Keep'],
  'backfill does not overwrite an existing profile'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.media_entries'::regclass),
  'media entries have row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.episode_entries'::regclass),
  'episode entries have row level security'
);

set local role anon;
select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  null,
  'anonymous users cannot read profiles'
);
select throws_ok(
  $$select * from public.media_entries$$,
  '42501',
  null,
  'anonymous users cannot read media tracking'
);
select throws_ok(
  $$select * from public.episode_entries$$,
  '42501',
  null,
  'anonymous users cannot read episode tracking'
);
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-1', true, false)$$,
  '42501',
  null,
  'anonymous users cannot insert tracking'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select display_name is null from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'$$,
  array[true],
  'user A reads their own profile'
);
select results_eq(
  $$update public.profiles set display_name = 'Ava' where user_id = '11111111-1111-1111-1111-111111111111' returning display_name$$,
  array['Ava'],
  'user A updates their own profile'
);
select throws_ok(
  $$update public.profiles set user_id = '22222222-2222-2222-2222-222222222222' where user_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'user A cannot transfer a profile to user B'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent, rating)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-42', 'watching', 8)
    returning show_intent$$,
  array['watching'],
  'user A inserts their own show'
);
select results_eq(
  $$select media_id from public.media_entries where media_id = 'trakt-show-42'$$,
  array['trakt-show-42'],
  'user A reads their own show'
);
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-42', 'plan')$$,
  '23505',
  null,
  'duplicate show tracking is rejected'
);
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-9', true, false, 11)$$,
  '23514',
  null,
  'a rating above 10 is rejected'
);
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-7', 'completed')$$,
  '23514',
  null,
  'completed is not stored as a fixed status'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-3', 'dropped')
    returning show_intent$$,
  array['dropped'],
  'dropped is stored until the user resumes'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-1', true, false)
    returning movie_saved$$,
  array[true],
  'a movie can be on the watchlist without being watched'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-2', true, true, 8)
    returning movie_watched$$,
  array[true],
  'a watched movie keeps its own rating'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-3', false, false, 4)
    returning movie_saved$$,
  array[false],
  'a movie rating can exist without watchlist membership'
);
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, movie_saved, movie_watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'movie', 'trakt-movie-4', false, false, 0)$$,
  '23514',
  null,
  'a rating below 1 is rejected'
);
select results_eq(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-42', 'trakt-episode-7', 1, 3, true, 9)
    returning episode_id$$,
  array['trakt-episode-7'],
  'user A stores a watched rated episode'
);
select results_eq(
  $$update public.episode_entries set rating = null where episode_id = 'trakt-episode-7' returning (rating is null and watched)$$,
  array[true],
  'user A can remove an episode rating without clearing watched'
);
select results_eq(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched, rating)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-42', 'trakt-episode-8', 1, 4, false, 6)
    returning watched$$,
  array[false],
  'an episode rating does not require the episode to be watched'
);
select throws_ok(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-42', 'trakt-episode-7', 1, 9, true)$$,
  '23505',
  null,
  'duplicate episode ids are rejected'
);
select throws_ok(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-42', 'trakt-episode-99', 1, 4, true)$$,
  '23505',
  null,
  'duplicate season and episode numbers are rejected'
);
select results_eq(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-100', 'trakt-episode-100', 2, 1, true)
    returning episode_id$$,
  array['trakt-episode-100'],
  'episode history can exist before a show tracking row'
);
select results_eq(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-100', 'plan')
    returning media_id$$,
  array['trakt-show-100'],
  'user A can add the show after its episodes'
);
select results_eq(
  $$delete from public.media_entries where media_id = 'trakt-show-100' returning media_id$$,
  array['trakt-show-100'],
  'user A can remove the show from the watchlist'
);
select results_eq(
  $$select watched from public.episode_entries where episode_id = 'trakt-episode-100'$$,
  array[true],
  'removing the show keeps the watched episode'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$insert into public.media_entries (user_id, media_type, media_id, show_intent)
    values ('11111111-1111-1111-1111-111111111111', 'show', 'trakt-show-5', 'plan')$$,
  '42501',
  null,
  'user B cannot insert a show owned by user A'
);
select throws_ok(
  $$insert into public.episode_entries (user_id, show_media_id, episode_id, season_number, episode_number, watched)
    values ('11111111-1111-1111-1111-111111111111', 'trakt-show-42', 'trakt-episode-15', 2, 1, true)$$,
  '42501',
  null,
  'user B cannot insert an episode owned by user A'
);
select is_empty(
  $$select * from public.media_entries$$,
  'user B cannot read user A media'
);
select is_empty(
  $$select * from public.episode_entries$$,
  'user B cannot read user A episodes'
);
select is_empty(
  $$select * from public.profiles$$,
  'user B cannot read user A profile'
);
select is_empty(
  $$update public.media_entries set show_intent = 'dropped' returning media_id$$,
  'user B cannot update user A media'
);
select is_empty(
  $$delete from public.episode_entries returning episode_id$$,
  'user B cannot delete user A episodes'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$select show_intent from public.media_entries where media_id = 'trakt-show-42'$$,
  array['watching'],
  'user B left user A show unchanged'
);
select results_eq(
  $$select watched from public.episode_entries where episode_id = 'trakt-episode-7'$$,
  array[true],
  'user B left user A episode unchanged'
);
select results_eq(
  $$select display_name from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'$$,
  array['Ava'],
  'user B left user A profile unchanged'
);

select * from finish();
rollback;
