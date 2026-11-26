-- Comment deletion polish: cascade, auth, notifications, counts.
-- Requires Social V4 + applied review interactions. Do not run against production.
begin;
select plan(12);

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
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_three', 'Gamma', true, true, true)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

-- Follows must predate activity for follow-since access checks.
insert into public.profile_follows (follower_id, following_id, created_at)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    now() - interval '3 hours'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    now() - interval '3 hours'
  )
on conflict (follower_id, following_id) do update
set created_at = excluded.created_at;

insert into public.social_activity_events (
  id, actor_id, activity_type, media_type, media_id, rating, created_at
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-901',
  9,
  now() - interval '2 hours'
)
on conflict (id) do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-901',
  'Owner review for delete polish.',
  false
)
on conflict do nothing;

insert into public.social_review_comments (
  id, activity_id, author_id, parent_comment_id, comment_text, contains_spoilers, created_at
)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    null,
    'Parent comment by beta',
    false,
    now() - interval '30 minutes'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'Reply by gamma',
    false,
    now() - interval '20 minutes'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    null,
    'Solo comment by beta',
    false,
    now() - interval '10 minutes'
  )
on conflict (id) do nothing;

insert into public.social_notifications (
  recipient_id, actor_id, type, entity_type, entity_id
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'review_commented',
    'review_comment',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'comment_replied',
    'review_comment',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
  )
on conflict do nothing;

select ok(
  (
    select pg_get_constraintdef(c.oid)
    from pg_constraint as c
    join pg_class as rel on rel.oid = c.conrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'social_review_comments'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like '%parent_comment_id%CASCADE%'
  ) is not null,
  'parent_comment_id FK cascades on delete'
);

-- Unauthorized delete
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select throws_ok(
  $$select public.delete_review_comment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')$$,
  'P0001',
  'not_authorized',
  'unrelated user cannot delete another author comment'
);

-- Author delete of leaf comment
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select lives_ok(
  $$select public.delete_review_comment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')$$,
  'author can delete own leaf comment'
);

select throws_ok(
  $$select public.delete_review_comment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')$$,
  'P0001',
  'comment_unavailable',
  'repeated delete is comment_unavailable'
);

-- Review owner deletes parent → reply cascades + notifications cleared
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select public.delete_review_comment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')$$,
  'review owner can delete parent comment'
);

-- Table privilege checks require a privileged inspector role; RPCs stay authenticated.
reset role;
select results_eq(
  $$select count(*)::int from public.social_review_comments
    where id in (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
    )$$,
  array[0],
  'parent delete cascades to reply'
);

select results_eq(
  $$select count(*)::int from public.social_notifications
    where entity_id in (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
    )$$,
  array[0],
  'notifications for deleted parent/reply are cleaned'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (public.get_review_interaction_summary('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')->>'comment_count')::integer,
  0,
  'interaction summary comment_count matches DB after deletes'
);

-- Restore a comment then block: review owner may still moderate.
reset role;
insert into public.social_review_comments (
  id, activity_id, author_id, comment_text, contains_spoilers
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Post-block seed',
  false
)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select public.block_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'owner can still block comment author'
);

select lives_ok(
  $$select public.delete_review_comment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4')$$,
  'review owner can delete comment after blocking author'
);

select throws_ok(
  $$select public.report_social_content(
      'review_comment',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
      'spam'
    )$$,
  'P0001',
  'activity_unavailable',
  'reporting deleted/blocked comment stays opaque'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where proname = 'delete_review_comment'
    order by oid desc
    limit 1
  ),
  'delete_review_comment remains SECURITY DEFINER'
);

select * from finish();
rollback;
