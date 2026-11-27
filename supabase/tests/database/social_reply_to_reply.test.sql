-- Reply-to-reply: flatten under root, notify target, SET NULL on target delete.
-- Requires Social V4 + 20261127190000_social_reply_to_reply.sql. Not for production.
begin;
select plan(10);

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
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-908',
  8,
  now() - interval '2 hours'
)
on conflict (id) do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-908',
  'Owner review for reply-to-reply.',
  false
)
on conflict do nothing;

insert into public.social_review_comments (
  id, activity_id, author_id, parent_comment_id, reply_to_comment_id,
  comment_text, contains_spoilers, created_at
)
values
  (
    '88888888-8888-8888-8888-888888888881',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    null,
    null,
    'Root by beta',
    false,
    now() - interval '40 minutes'
  ),
  (
    '88888888-8888-8888-8888-888888888882',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '88888888-8888-8888-8888-888888888881',
    null,
    'Reply by alpha',
    false,
    now() - interval '30 minutes'
  );

-- Column + FK present
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'social_review_comments'
      and column_name = 'reply_to_comment_id'
  ),
  'reply_to_comment_id column exists'
);

select ok(
  (
    select pg_get_constraintdef(c.oid)
    from pg_constraint as c
    join pg_class as rel on rel.oid = c.conrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'social_review_comments'
      and c.conname = 'social_review_comments_reply_to_comment_id_fkey'
  ) like '%ON DELETE SET NULL%',
  'reply_to_comment_id FK uses ON DELETE SET NULL'
);

-- Gamma replies to alpha's reply
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select lives_ok(
  $$select public.create_review_comment(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'::uuid,
      'Nested reply by gamma',
      false,
      '88888888-8888-8888-8888-888888888882'::uuid
    )$$,
  'create reply-to-reply succeeds'
);

-- Direct table/notification inspection requires a privileged test role.
reset role;

select is(
  (
    select jsonb_build_object(
      'parent', c.parent_comment_id,
      'reply_to', c.reply_to_comment_id
    )
    from public.social_review_comments as c
    where c.comment_text = 'Nested reply by gamma'
    order by c.created_at desc
    limit 1
  ),
  jsonb_build_object(
    'parent', '88888888-8888-8888-8888-888888888881'::uuid,
    'reply_to', '88888888-8888-8888-8888-888888888882'::uuid
  ),
  'stores root parent and clicked reply_to'
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
  'notifies clicked reply author'
);

-- List exposes reply_to username (RPC as gamma).
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(
  (
    select reply_to_author_username
    from public.list_review_comments('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'::uuid, 50)
    where comment_text = 'Nested reply by gamma'
  ),
  'alpha_one',
  'list_review_comments returns reply_to username'
);

-- Self-reply: no notification
reset role;
update public.social_review_comments
set created_at = now() - interval '1 hour'
where author_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select public.create_review_comment(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'::uuid,
      'Owner replies to own reply',
      false,
      '88888888-8888-8888-8888-888888888882'::uuid
    )$$,
  'owner can reply to own reply'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.social_notifications
    where recipient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and type = 'comment_replied'
  ),
  0,
  'self reply-to-reply creates no notification'
);

-- Delete clicked reply: nested row remains with reply_to cleared
reset role;
delete from public.social_review_comments
where id = '88888888-8888-8888-8888-888888888882';

select ok(
  exists (
    select 1
    from public.social_review_comments
    where comment_text = 'Nested reply by gamma'
      and parent_comment_id = '88888888-8888-8888-8888-888888888881'
      and reply_to_comment_id is null
  ),
  'deleting reply target sets reply_to null without cascading siblings'
);

-- Root delete still cascades the flat thread
delete from public.social_review_comments
where id = '88888888-8888-8888-8888-888888888881';

select is(
  (
    select count(*)::integer
    from public.social_review_comments
    where activity_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'
  ),
  0,
  'deleting root cascades all flat replies'
);

select * from finish();
rollback;
