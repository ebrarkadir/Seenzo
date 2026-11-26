begin;
select plan(30);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma@example.com')
on conflict (id) do nothing;

insert into public.profiles (
  user_id, username, display_name, is_public, allow_profile_discovery,
  share_activity_with_followers, avatar_path
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, true, true, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, true, true, null),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', true, true, true, null)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_blocks'::regclass),
  'user_blocks has RLS'
);

select ok(
  (
    select count(*) = 0
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_blocks'
  ),
  'user_blocks has no authenticated table policies'
);

insert into public.profile_follows (follower_id, following_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

insert into public.profile_follow_requests (requester_id, target_id, status)
select 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending'
where not exists (
  select 1 from public.profile_follow_requests
  where requester_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and status = 'pending'
);

insert into public.profile_follow_requests (requester_id, target_id, status)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pending'
where not exists (
  select 1 from public.profile_follow_requests
  where requester_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    and status = 'pending'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok(
  $$select public.block_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'P0001',
  'cannot_block_self',
  'self-block is rejected'
);

select throws_ok(
  $$insert into public.user_blocks (blocker_id, blocked_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501',
  'direct insert into user_blocks is denied'
);

select lives_ok(
  $$select public.block_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'A can block B'
);

select results_eq(
  $$select count(*)::int from public.user_blocks
    where blocker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and blocked_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[1],
  'block row is stored for blocker'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where (follower_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and following_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       or (follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
           and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  array[0],
  'block clears bidirectional follows'
);

select results_eq(
  $$select count(*)::int from public.profile_follow_requests
    where status = 'pending'
      and (
        (requester_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         and target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
        or (requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
            and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      )$$,
  array[0],
  'block removes pending requests between A and B'
);

select throws_ok(
  $$select * from public.request_or_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'P0001',
  'blocked',
  'blocked target cannot be followed or requested'
);

select throws_ok(
  $$select * from public.get_discoverable_profile_card('beta_two')$$,
  'P0001',
  'profile_not_found',
  'blocked profile card is opaque'
);

select results_eq(
  $$select count(*)::int from public.search_discoverable_profiles('beta', 0, 20)$$,
  array[0],
  'search excludes blocked profiles'
);

select results_eq(
  $$select public.social_is_blocked(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    )$$,
  array[true],
  'helper reports two-way block for involved caller'
);

select results_eq(
  $$select public.social_is_blocked(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc'
    )$$,
  array[false],
  'helper refuses third-party UUID pair probing'
);

-- Leftover pending request while blocked: accept must cancel and commit (no RAISE rollback).
reset role;
insert into public.profile_follow_requests (id, requester_id, target_id, status)
select
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'pending'
where not exists (
  select 1 from public.profile_follow_requests
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select results_eq(
  $$select public.accept_follow_request('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  array[false],
  'accept returns false when requester is blocked'
);

select results_eq(
  $$select status from public.profile_follow_requests
    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$,
  array['cancelled'::text],
  'accept cancels blocked request without rollback'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'accept does not create follow when blocked'
);

reset role;
insert into public.social_notifications (recipient_id, actor_id, type)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'new_follower'
)
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select results_eq(
  $$select count(*)::int from public.list_social_notifications(0, 50)
    where actor_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[0],
  'notifications exclude blocked actors'
);

select results_eq(
  $$select count(*)::int from public.list_blocked_users(0, 30)
    where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[1],
  'blocker can list blocked users'
);

select lives_ok(
  $$select public.unblock_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'blocker can unblock'
);

select results_eq(
  $$select count(*)::int from public.user_blocks
    where blocker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and blocked_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[0],
  'unblock removes block row'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where (follower_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and following_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       or (follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
           and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  array[0],
  'unblock does not restore follows'
);

select lives_ok(
  $$select * from public.request_or_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'after unblock, new follow/request is allowed'
);

select lives_ok(
  $$select public.block_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  're-block for foreign unblock test'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select lives_ok(
  $$select public.unblock_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'B unblock A only affects B->A edge (idempotent when missing)'
);

reset role;
select results_eq(
  $$select count(*)::int from public.user_blocks
    where blocker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and blocked_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[1],
  'cannot unblock on behalf of another user — A->B block remains'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok(
  $$select * from public.list_profile_reviews('beta_two', 'all', 20)$$,
  'P0001',
  'profile_not_found',
  'profile reviews denied while blocked'
);

select is(
  (
    select count(*)::int
    from jsonb_array_elements(
      public.get_friends_media_ratings('movie', 'trakt-movie-1', 5, 0)->'items'
    ) as item
    where item->>'actor_user_id' = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  ),
  0,
  'friends ratings exclude blocked actors'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where proname = 'block_user'
    order by oid desc
    limit 1
  ),
  'block_user is SECURITY DEFINER'
);

select ok(
  (
    select coalesce(array_to_string(proconfig, ','), '') like '%search_path%'
    from pg_proc
    where proname = 'block_user'
    order by oid desc
    limit 1
  ),
  'block_user pins search_path'
);

select throws_ok(
  $$select public.block_user(null)$$,
  'P0001',
  'invalid_target',
  'null target rejected'
);

select * from finish();
rollback;
