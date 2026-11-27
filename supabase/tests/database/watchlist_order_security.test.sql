begin;
select plan(14);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha-order@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta-order@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (user_id) do nothing;

insert into public.media_entries (
  user_id, media_type, media_id, movie_saved, movie_watched, rating
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'movie', 'trakt-movie-101', true, false, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'movie', 'trakt-movie-102', true, false, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'movie', 'trakt-movie-103', true, false, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'movie', 'trakt-movie-199', false, true, 8);

insert into public.media_entries (
  user_id, media_type, media_id, show_intent, rating
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'show', 'trakt-show-201', 'plan', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'show', 'trakt-show-202', 'plan', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'show', 'trakt-show-203', 'watching', null);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.watchlist_order_items'::regclass),
  'watchlist_order_items has RLS'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.watchlist_order_revisions'::regclass),
  'watchlist_order_revisions has RLS'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-101","trakt-movie-102","trakt-movie-103"]'::jsonb,
    0
  )$$,
  'owner can set movie watchlist order'
);

select results_eq(
  $$select media_id from public.watchlist_order_items
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and media_type = 'movie'
    order by position$$,
  array['trakt-movie-101','trakt-movie-102','trakt-movie-103']::text[],
  'movie order persists densely'
);

select results_eq(
  $$select revision from public.watchlist_order_revisions
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and media_type = 'movie'$$,
  array[1::bigint],
  'revision increments after set'
);

select throws_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-103","trakt-movie-101","trakt-movie-102"]'::jsonb,
    0
  )$$,
  'P0001',
  'stale_revision',
  'stale expected revision is rejected'
);

select lives_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-103","trakt-movie-101","trakt-movie-102"]'::jsonb,
    1
  )$$,
  'matching revision can replace order'
);

select throws_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-101","trakt-movie-101"]'::jsonb,
    2
  )$$,
  'P0001',
  'duplicate_media',
  'duplicate ids rejected'
);

select throws_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-199"]'::jsonb,
    2
  )$$,
  'P0001',
  'not_on_watchlist',
  'watched-only movie cannot be ordered'
);

select lives_ok(
  $$select * from public.set_watchlist_order(
    'show',
    '["trakt-show-202","trakt-show-201"]'::jsonb,
    null
  )$$,
  'null expected revision still replaces when unlocked'
);

select throws_ok(
  $$select * from public.set_watchlist_order(
    'show',
    '["trakt-show-203"]'::jsonb,
    null
  )$$,
  'P0001',
  'not_on_watchlist',
  'watching show cannot be ordered as plan list'
);

select throws_ok(
  $$insert into public.watchlist_order_items (user_id, media_type, media_id, position)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'movie', 'trakt-movie-101', 1)$$,
  '42501',
  null,
  'cannot insert order rows for another user'
);

select results_eq(
  $$select count(*)::int from public.watchlist_order_items
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[0],
  'cannot read other user order rows'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select throws_ok(
  $$select * from public.set_watchlist_order(
    'movie',
    '["trakt-movie-101"]'::jsonb,
    0
  )$$,
  'P0001',
  'not_on_watchlist',
  'other user cannot order owner media'
);

select * from finish();
rollback;
