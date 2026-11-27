begin;
select plan(4);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha-added@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta-added@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (user_id) do nothing;

select has_column(
  'public',
  'media_entries',
  'watchlist_added_at',
  'media_entries has watchlist_added_at'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$insert into public.media_entries (
      user_id, media_type, media_id, movie_saved, movie_watched, rating, watchlist_added_at
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'movie',
      'trakt-movie-501',
      true,
      false,
      null,
      '2026-01-15T12:00:00Z'
    )$$,
  'owner can set watchlist_added_at on insert'
);

select results_eq(
  $$select watchlist_added_at = '2026-01-15T12:00:00Z'
    from public.media_entries
    where media_id = 'trakt-movie-501'$$,
  array[true],
  'watchlist_added_at persists for owner'
);

select throws_ok(
  $$insert into public.media_entries (
      user_id, media_type, media_id, movie_saved, movie_watched, rating, watchlist_added_at
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'movie',
      'trakt-movie-502',
      true,
      false,
      null,
      '2026-01-16T12:00:00Z'
    )$$,
  '42501',
  null,
  'cannot insert watchlist_added_at for another user'
);

select * from finish();
rollback;
