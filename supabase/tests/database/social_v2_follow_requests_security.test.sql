begin;
select plan(39);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma@example.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'delta@example.com')
on conflict (id) do nothing;

insert into public.profiles (user_id, username, display_name, is_public, allow_profile_discovery, avatar_path)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', false, true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/avatar/token1.jpg'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/avatar/token2.jpg'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', false, false, 'cccccccc-cccc-cccc-cccc-cccccccccccc/avatar/token3.jpg'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'a_b_user', 'Delta', true, false, null)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    avatar_path = excluded.avatar_path;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_follow_requests'::regclass),
  'follow requests have RLS'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.social_notifications'::regclass),
  'social notifications have RLS'
);

select ok(
  (
    select coalesce(
      (
        select pg_get_expr(pol.polqual, pol.polrelid)
        from pg_policy as pol
        join pg_class as cls on cls.oid = pol.polrelid
        join pg_namespace as nsp on nsp.oid = cls.relnamespace
        where nsp.nspname = 'storage'
          and cls.relname = 'objects'
          and pol.polname = 'profile_media_select_discoverable_profiles'
      ),
      ''
    ) like '%avatar_path% = name%'
  ),
  'discoverable storage policy matches active avatar_path only'
);

select ok(
  (
    select prosrc like '%escape ''!''%'
      and prosrc like '%!_%'
    from pg_proc
    where proname = 'search_discoverable_profiles'
    order by oid desc
    limit 1
  ),
  'search_discoverable_profiles uses bang ESCAPE for literal underscores'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select lives_ok(
  $$select * from public.request_or_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'public user can request to follow discoverable private profile'
);

select results_eq(
  $$select status from public.profile_follow_requests
    where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and status = 'pending'$$,
  array['pending'::text],
  'pending follow request is stored'
);

-- Concurrent / retry: second call must reuse the same pending request id and not duplicate notifications.
select results_eq(
  $$select request_id from public.request_or_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  $$select id from public.profile_follow_requests
      where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and status = 'pending'
      limit 1$$,
  'duplicate request_or_follow returns the same pending request id'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'follow_request'$$,
  array[1],
  'duplicate request does not create duplicate notifications'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'no follow edge before acceptance'
);

select throws_ok(
  $$select * from public.request_or_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'P0001',
  'invalid_follow',
  'self follow request is rejected'
);

select throws_ok(
  $$select * from public.request_or_follow('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'P0001',
  'profile_not_discoverable',
  'hidden private profiles cannot be requested'
);

select throws_ok(
  $$select * from public.get_social_relationship('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'P0001',
  'profile_not_found',
  'hidden private profiles are opaque to relationship rpc'
);

select throws_ok(
  $$select * from public.get_discoverable_profile_card('gamma_three')$$,
  'P0001',
  'profile_not_found',
  'hidden private profiles are not available as discoverable cards'
);

select results_eq(
  $$select count(*)::int from public.search_discoverable_profiles('gamma', 0, 20)$$,
  array[0],
  'hidden private usernames are excluded from search'
);

select throws_ok(
  $$select public.accept_follow_request(
      (select id from public.profile_follow_requests
        where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
          and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and status = 'pending'
        limit 1)
    )$$,
  'P0001',
  'not_request_recipient',
  'requester cannot accept own request'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select lives_ok(
  $$select public.accept_follow_request(
      (select id from public.profile_follow_requests
        where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
          and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and status = 'pending'
        limit 1)
    )$$,
  'recipient can accept follow request'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[1],
  'follow edge created after acceptance'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'follow_request_accepted'$$,
  array[1],
  'requester receives acceptance notification'
);

-- Cancel + resend (after cooldown window)
delete from public.profile_follows
where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select * from public.request_or_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'can request again after unfollow'
);

select lives_ok(
  $$select public.cancel_follow_request('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'requester can cancel own pending request'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'follow_request'$$,
  array[0],
  'cancel removes follow_request notification'
);

-- Backdate resolved request so cooldown does not block legitimate resend in tests.
update public.profile_follow_requests
set updated_at = now() - interval '2 minutes',
    resolved_at = now() - interval '2 minutes'
where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and status = 'cancelled';

select lives_ok(
  $$select * from public.request_or_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'can resend follow request after cancel once cooldown elapsed'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'follow_request'$$,
  array[1],
  'resend creates a fresh follow_request notification'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select lives_ok(
  $$select public.reject_follow_request(
      (select id from public.profile_follow_requests
        where requester_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
          and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and status = 'pending'
        limit 1)
    )$$,
  'recipient can reject follow request'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'reject does not create follow edge'
);

-- Unfollow / refollow notification lifecycle on a public profile
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select lives_ok(
  $$select * from public.request_or_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'private discoverable user can follow a public profile'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and type = 'new_follower'$$,
  array[1],
  'public follow creates new_follower notification'
);

delete from public.profile_follows
where follower_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and following_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and type = 'new_follower'$$,
  array[0],
  'unfollow clears prior new_follower notification'
);

select lives_ok(
  $$select * from public.request_or_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'can follow the same public profile again'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and type = 'new_follower'$$,
  array[1],
  'genuine re-follow creates a new new_follower notification'
);

-- Account-scoped notification reads / unauthorized mark-read
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select results_eq(
  $$select count(*)::int from public.list_social_notifications(0, 30)$$,
  array[0],
  'unrelated users cannot list others notifications via rpc'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[0],
  'unrelated users cannot read others notifications via table select'
);

select results_eq(
  $$select public.mark_social_notification_read(
      (select id from public.social_notifications
        where recipient_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        limit 1)
    )$$,
  array[false],
  'cannot mark another users notification as read'
);

select throws_ok(
  $$insert into public.social_notifications (recipient_id, actor_id, type)
    values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'new_follower'
    )$$,
  '42501',
  null,
  'clients cannot insert notifications'
);

-- Search: literal underscore, discoverable private appears, hidden does not
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq(
  $$select count(*)::int from public.search_discoverable_profiles('alpha', 0, 20)$$,
  array[1],
  'discoverable private username appears in search rpc'
);

select results_eq(
  $$select username from public.search_discoverable_profiles('a_b', 0, 20)$$,
  array['a_b_user'::text],
  'username search treats underscore as a literal character'
);

select results_eq(
  $$select count(*)::int from public.get_discoverable_profile_card('alpha_one')$$,
  array[1],
  'discoverable private limited card is readable'
);

-- Existing approved follow remains after public -> private
insert into public.profile_follows (follower_id, following_id)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict do nothing;

update public.profiles
set is_public = false,
    allow_profile_discovery = false
where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select results_eq(
  $$select is_following from public.get_social_relationship('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  array[true],
  'approved follow remains queryable after target leaves public discovery'
);

select results_eq(
  $$select count(*)::int from public.profile_follows
    where follower_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and following_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  array[1],
  'follow edge is preserved across public/private visibility change'
);

-- Restore beta public for any later suite reuse within the transaction
update public.profiles
set is_public = true,
    allow_profile_discovery = false
where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select * from finish();
rollback;
