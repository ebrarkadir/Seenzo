-- Social V4 review likes/comments/notifications authorization (pgTAP).
-- Not executed in CI by default; run manually against a disposable DB after
-- applying 20261126180000_social_review_interactions.sql.
begin;
select plan(26);

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

-- Alpha publishes a shared rating + review (fixed id for authenticated RPC args).
reset role;
insert into public.social_activity_events (
  id, actor_id, activity_type, media_type, media_id, rating, created_at
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-41',
  8,
  now() - interval '1 hour'
)
on conflict (id) do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-41',
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  'P0001',
  'activity_unavailable',
  'non-follower cannot like shared review'
);

reset role;
insert into public.profile_follows (follower_id, following_id, created_at)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now() - interval '2 hours'
)
on conflict (follower_id, following_id) do update
set created_at = excluded.created_at;

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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )->>'liked')::boolean,
  'follower can like'
);

select ok(
  (public.like_review_activity(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )->>'like_count')::integer = 1,
  'duplicate like stays count 1'
);

reset role;
select is(
  (select count(*)::integer
     from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'review_liked'),
  1,
  'like creates one notification'
);
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select lives_ok(
  $$select public.unlike_review_activity(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  'unlike succeeds'
);

reset role;
select is(
  (select count(*)::integer
     from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and type = 'review_liked'),
  0,
  'unlike removes like notification'
);
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Re-like for comment tests
select public.like_review_activity(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
);

select ok(
  (public.create_review_comment(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid,
      'Beta comment',
      false,
      null
    )->>'id') is not null,
  'follower can comment'
);

reset role;
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  'P0001',
  'cannot_like_own',
  'owner cannot like own review'
);

-- Reply-to-reply: flat under root; reply_to points at clicked reply; notify that author.
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

reset role;
insert into public.social_review_comments (
  id, activity_id, author_id, parent_comment_id, comment_text, contains_spoilers, created_at
)
select
  '22222222-2222-2222-2222-222222222222'::uuid,
  a.id,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  null,
  'Parent for reply-to-reply',
  false,
  now() - interval '10 seconds'
from public.social_activity_events as a
where a.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and a.media_id = 'trakt-movie-41'
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
  and a.media_id = 'trakt-movie-41'
limit 1;

-- Use gamma (no recent RPC comments) so create is not rate-limited.
reset role;
insert into public.profile_follows (follower_id, following_id, created_at)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now() - interval '2 hours'
)
on conflict (follower_id, following_id) do update
set created_at = excluded.created_at;

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select lives_ok(
  $$select public.create_review_comment(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid,
      'Reply to a reply',
      false,
      '33333333-3333-3333-3333-333333333333'::uuid
    )$$,
  'can reply to a reply'
);

-- Direct table/notification inspection requires a privileged test role.
reset role;

select is(
  (
    select c.parent_comment_id
    from public.social_review_comments as c
    where c.author_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and c.comment_text = 'Reply to a reply'
    order by c.created_at desc
    limit 1
  ),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'reply-to-reply stores thread root as parent_comment_id'
);

select is(
  (
    select c.reply_to_comment_id
    from public.social_review_comments as c
    where c.author_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and c.comment_text = 'Reply to a reply'
    order by c.created_at desc
    limit 1
  ),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'reply-to-reply stores clicked target as reply_to_comment_id'
);

select is(
  (
    select count(*)::integer
    from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and type = 'comment_replied'
  ),
  1,
  'reply-to-reply notifies the clicked comment author'
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  'P0001',
  'activity_unavailable',
  'sharing off hides discussion'
);

select throws_ok(
  $$select public.list_review_comments(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
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
insert into public.profile_follows (follower_id, following_id, created_at)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    now() - interval '2 hours'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    now() - interval '2 hours'
  )
on conflict (follower_id, following_id) do update
set created_at = excluded.created_at;

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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
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
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  '42501',
  null,
  'clients cannot insert interaction notifications'
);

select throws_ok(
  $$select public.social_can_access_review_activity(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
    )$$,
  '42501',
  null,
  'authenticated cannot execute internal access helper'
);

reset role;
select ok(
  public.social_can_access_review_activity(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa41'::uuid
  ),
  'follower with sharing on can access helper'
);

select * from finish();
rollback;
