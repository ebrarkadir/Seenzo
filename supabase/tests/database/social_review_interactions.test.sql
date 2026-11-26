-- Social V4 review likes/comments/notifications authorization (pgTAP).
-- Not executed in CI by default; run manually against a disposable DB after
-- applying 20261126180000_social_review_interactions.sql.
begin;
select plan(22);

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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, false, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, false, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', true, false, true)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

-- Alpha publishes a shared rating + review.
reset role;
select public.social_upsert_activity_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-v4-1',
  null, null, null, 8,
  '11111111-1111-1111-1111-111111111111'::uuid,
  true
);

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-v4-1',
  'Alpha review text',
  false
)
on conflict do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.social_review_likes'::regclass),
  'likes table has RLS'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.social_review_comments'::regclass),
  'comments table has RLS'
);

-- Beta is not following yet: like must fail.
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$select public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'activity_unavailable',
  'non-follower cannot like shared review'
);

reset role;
insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

-- Pending private request alone is not enough (gamma → alpha request, no follow).
delete from public.profile_follow_requests
where requester_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and status = 'pending';

insert into public.profile_follow_requests (requester_id, target_id, status)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'pending'
);

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select throws_ok(
  $$select public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'activity_unavailable',
  'pending follow request cannot like'
);

-- Follower beta can like (idempotent).
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select ok(
  (public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )->>'liked')::boolean,
  'follower can like'
);

select ok(
  (public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )->>'like_count')::integer = 1,
  'duplicate like stays count 1'
);

select is(
  (select count(*)::integer
     from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'review_liked'),
  1,
  'like creates one notification'
);

select lives_ok(
  $$select public.unlike_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'unlike succeeds'
);

select is(
  (select count(*)::integer
     from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'review_liked'),
  0,
  'unlike removes like notification'
);

-- Re-like for comment tests
select public.like_review_activity(
  (select id from public.social_activity_events
    where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and media_id = 'trakt-movie-v4-1'
    limit 1)
);

select ok(
  (public.create_review_comment(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1),
      'Beta comment',
      false,
      null
    )->>'id') is not null,
  'follower can comment'
);

select is(
  (select count(*)::integer
     from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and type = 'review_commented'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'comment notifies review owner'
);

-- Owner cannot self-notify on own comment path is covered by social_insert_notification.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok(
  $$select public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'cannot_like_own',
  'owner cannot like own review'
);

-- Reply depth: create parent as beta, reply as alpha, forbid reply-to-reply.
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Wait out anti-spam window in real DB; in tests advance clock if available.
-- Use a second distinct author path via reset and direct insert for parent/child depth check.
reset role;
insert into public.social_review_comments (
  id, activity_id, author_id, parent_comment_id, comment_text, contains_spoilers, created_at
)
select
  '22222222-2222-2222-2222-222222222222'::uuid,
  a.id,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  null,
  'Parent for depth',
  false,
  now() - interval '10 seconds'
from public.social_activity_events as a
where a.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and a.media_id = 'trakt-movie-v4-1'
limit 1;

insert into public.social_review_comments (
  id, activity_id, author_id, parent_comment_id, comment_text, contains_spoilers, created_at
)
select
  '33333333-3333-3333-3333-333333333333'::uuid,
  a.id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Reply level one',
  false,
  now() - interval '5 seconds'
from public.social_activity_events as a
where a.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and a.media_id = 'trakt-movie-v4-1'
limit 1;

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$select public.create_review_comment(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1),
      'Too deep',
      false,
      '33333333-3333-3333-3333-333333333333'::uuid
    )$$,
  'P0001',
  'reply_depth_exceeded',
  'cannot reply to a reply'
);

-- Sharing off hides access.
reset role;
update public.profiles
set share_activity_with_followers = false
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$select public.get_review_interaction_summary(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'activity_unavailable',
  'sharing off hides discussion'
);

select throws_ok(
  $$select public.list_review_comments(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'activity_unavailable',
  'sharing off hides comments list'
);

-- Restore sharing, unfollow, access revoked.
reset role;
update public.profiles
set share_activity_with_followers = true
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

delete from public.profile_follows
where follower_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and following_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$select public.like_review_activity(
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  'P0001',
  'activity_unavailable',
  'unfollow revokes new likes'
);

-- Guessed UUID cannot leak.
select throws_ok(
  $$select public.get_review_interaction_summary(
      '99999999-9999-9999-9999-999999999999'::uuid
    )$$,
  'P0001',
  'activity_unavailable',
  'guessed activity uuid unavailable'
);

-- Delete authorization: gamma cannot delete beta's comment even after follow.
reset role;
insert into public.profile_follows (follower_id, following_id)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select throws_ok(
  $$select public.delete_review_comment(
      '22222222-2222-2222-2222-222222222222'::uuid
    )$$,
  'P0001',
  'not_authorized',
  'unrelated follower cannot delete comment'
);

-- Owner can moderate.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select ok(
  public.delete_review_comment('22222222-2222-2222-2222-222222222222'::uuid),
  'review owner can delete comment'
);

-- No client inserts into likes.
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select throws_ok(
  $$insert into public.social_review_likes (user_id, activity_id)
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  '42501',
  null,
  'clients cannot insert likes directly'
);

select throws_ok(
  $$insert into public.social_notifications (
      recipient_id, actor_id, type, entity_type, entity_id
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'review_liked',
      'social_activity',
      (select id from public.social_activity_events
        where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and media_id = 'trakt-movie-v4-1'
        limit 1)
    )$$,
  '42501',
  null,
  'clients cannot insert interaction notifications'
);

select ok(
  public.social_can_access_review_activity(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    (select id from public.social_activity_events
      where actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and media_id = 'trakt-movie-v4-1'
      limit 1)
  ),
  'follower with sharing on can access helper'
);

select * from finish();
rollback;
