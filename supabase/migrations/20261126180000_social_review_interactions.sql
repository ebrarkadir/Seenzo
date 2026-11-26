-- Social V4: review likes, comments (one-level replies), interaction notifications.
-- Additive only. Does not alter historical Social V1–V3 migration files.
-- Safe to apply after Social V3 rating feed + user_media_reviews are present.
--
-- Interactions target social_activity_events rating rows that still have a review
-- and are visible under the same follow + share_activity_with_followers rules as
-- list_following_activity. Pending follow requests are never enough.
--
-- If repo SQL and deployed SQL drifted for earlier social migrations, apply this
-- only after confirming social_activity_events, profile_follows, profiles.share_*,
-- user_media_reviews, and social_notifications exist.

-- ---------------------------------------------------------------------------
-- Extend notification types (preserve existing rows)
-- ---------------------------------------------------------------------------
alter table public.social_notifications
  drop constraint if exists social_notifications_type_check;

alter table public.social_notifications
  add constraint social_notifications_type_check check (
    type in (
      'new_follower',
      'follow_request',
      'follow_request_accepted',
      'review_liked',
      'review_commented',
      'comment_replied'
    )
  );

-- ---------------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------------
create table if not exists public.social_review_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_id uuid not null references public.social_activity_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, activity_id)
);

create index if not exists social_review_likes_activity_created_idx
  on public.social_review_likes (activity_id, created_at desc);

revoke all on table public.social_review_likes from public, anon, authenticated;
grant select, insert, delete on table public.social_review_likes to service_role;

alter table public.social_review_likes enable row level security;
-- No authenticated table policies: all access via SECURITY DEFINER RPCs.

comment on table public.social_review_likes is
  'Likes on shared rating/review activities. Clients must use like/unlike RPCs; no broad SELECT.';

-- ---------------------------------------------------------------------------
-- Comments (one reply level)
-- ---------------------------------------------------------------------------
create table if not exists public.social_review_comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.social_activity_events (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_comment_id uuid references public.social_review_comments (id) on delete cascade,
  comment_text text not null,
  contains_spoilers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_review_comments_text_len check (
    char_length(btrim(comment_text)) between 1 and 300
  )
);

create index if not exists social_review_comments_activity_created_idx
  on public.social_review_comments (activity_id, created_at asc, id asc);

create index if not exists social_review_comments_parent_idx
  on public.social_review_comments (parent_comment_id)
  where parent_comment_id is not null;

create index if not exists social_review_comments_author_created_idx
  on public.social_review_comments (author_id, created_at desc);

revoke all on table public.social_review_comments from public, anon, authenticated;
grant select, insert, delete, update on table public.social_review_comments to service_role;

alter table public.social_review_comments enable row level security;

comment on table public.social_review_comments is
  'Comments/replies on shared rating reviews. One reply level. Access via RPCs only.';

-- ---------------------------------------------------------------------------
-- Optional lightweight reports (basic moderation intake)
-- ---------------------------------------------------------------------------
create table if not exists public.social_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint social_content_reports_target_type_check check (
    target_type in ('review_comment', 'social_activity')
  ),
  constraint social_content_reports_reason_len check (
    reason is null or char_length(reason) <= 280
  )
);

create unique index if not exists social_content_reports_dedupe_idx
  on public.social_content_reports (reporter_id, target_type, target_id);

create index if not exists social_content_reports_created_idx
  on public.social_content_reports (created_at desc);

revoke all on table public.social_content_reports from public, anon, authenticated;
grant select, insert on table public.social_content_reports to service_role;

alter table public.social_content_reports enable row level security;

comment on table public.social_content_reports is
  'Basic content reports. Intake only; admin handling is out of band before public release.';

-- ---------------------------------------------------------------------------
-- Access helper (internal)
-- ---------------------------------------------------------------------------
create or replace function public.social_is_rating_activity_type(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('movie_rated', 'show_rated', 'episode_rated');
$$;

revoke all on function public.social_is_rating_activity_type(text) from public, anon, authenticated;
grant execute on function public.social_is_rating_activity_type(text) to service_role;

-- True when caller may see/interact with a rating activity that currently has a review.
-- Mirrors feed visibility: approved follow + sharing ON (+ follow-since gate), or ownership.
create or replace function public.social_can_access_review_activity(
  p_caller uuid,
  p_activity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_caller is not null
    and p_activity_id is not null
    and exists (
      select 1
      from public.social_activity_events as a
      join public.profiles as p
        on p.user_id = a.actor_id
      join public.user_media_reviews as r
        on r.user_id = a.actor_id
       and r.media_id = a.media_id
      where a.id = p_activity_id
        and public.social_is_rating_activity_type(a.activity_type)
        and p.username is not null
        and length(btrim(r.review_text)) > 0
        and (
          a.actor_id = p_caller
          or (
            p.share_activity_with_followers = true
            and exists (
              select 1
              from public.profile_follows as f
              where f.follower_id = p_caller
                and f.following_id = a.actor_id
                and a.created_at >= f.created_at
            )
          )
        )
    );
$$;

revoke all on function public.social_can_access_review_activity(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.social_can_access_review_activity(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Feed: include interaction summary columns (drop/recreate for returns change)
-- ---------------------------------------------------------------------------
drop function if exists public.list_following_activity(integer, timestamptz, uuid);

create or replace function public.list_following_activity(
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  activity_type text,
  media_type text,
  media_id text,
  show_media_id text,
  season_number integer,
  episode_number integer,
  rating numeric,
  created_at timestamptz,
  actor_user_id uuid,
  actor_username text,
  actor_display_name text,
  actor_avatar_path text,
  actor_is_public boolean,
  review_text text,
  review_contains_spoilers boolean,
  like_count integer,
  comment_count integer,
  liked_by_viewer boolean,
  interactions_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_size integer := least(30, greatest(1, coalesce(p_limit, 20)));
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;

  return query
  select
    a.id,
    a.activity_type,
    a.media_type,
    a.media_id,
    a.show_media_id,
    a.season_number,
    a.episode_number,
    a.rating,
    a.created_at,
    p.user_id as actor_user_id,
    p.username as actor_username,
    p.display_name as actor_display_name,
    p.avatar_path as actor_avatar_path,
    p.is_public as actor_is_public,
    case
      when public.social_is_rating_activity_type(a.activity_type)
        then r.review_text
      else null
    end as review_text,
    case
      when public.social_is_rating_activity_type(a.activity_type)
        then coalesce(r.contains_spoilers, false)
      else null
    end as review_contains_spoilers,
    case
      when public.social_is_rating_activity_type(a.activity_type)
        and r.review_text is not null
        and length(btrim(r.review_text)) > 0
        then (
          select count(*)::integer
          from public.social_review_likes as likes
          where likes.activity_id = a.id
        )
      else 0
    end as like_count,
    case
      when public.social_is_rating_activity_type(a.activity_type)
        and r.review_text is not null
        and length(btrim(r.review_text)) > 0
        then (
          select count(*)::integer
          from public.social_review_comments as comments
          where comments.activity_id = a.id
        )
      else 0
    end as comment_count,
    case
      when public.social_is_rating_activity_type(a.activity_type)
        and r.review_text is not null
        and length(btrim(r.review_text)) > 0
        then exists (
          select 1
          from public.social_review_likes as likes
          where likes.activity_id = a.id
            and likes.user_id = v_caller
        )
      else false
    end as liked_by_viewer,
    (
      public.social_is_rating_activity_type(a.activity_type)
      and r.review_text is not null
      and length(btrim(r.review_text)) > 0
    ) as interactions_enabled
  from public.social_activity_events as a
  join public.profile_follows as f
    on f.follower_id = v_caller
   and f.following_id = a.actor_id
   and a.created_at >= f.created_at
  join public.profiles as p
    on p.user_id = a.actor_id
  left join public.user_media_reviews as r
    on r.user_id = a.actor_id
   and r.media_id = a.media_id
   and public.social_is_rating_activity_type(a.activity_type)
  where p.share_activity_with_followers = true
    and p.username is not null
    and (
      p_cursor_created_at is null
      or (a.created_at, a.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by a.created_at desc, a.id desc
  limit v_size;
end;
$$;

revoke all on function public.list_following_activity(integer, timestamptz, uuid) from public, anon;
grant execute on function public.list_following_activity(integer, timestamptz, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Like / unlike
-- ---------------------------------------------------------------------------
create or replace function public.like_review_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_actor uuid;
  v_count integer;
  v_liked boolean;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_id is null then
    raise exception 'invalid_activity';
  end if;
  if not public.social_can_access_review_activity(v_caller, p_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  select a.actor_id into v_actor
  from public.social_activity_events as a
  where a.id = p_activity_id;

  if v_actor is null then
    raise exception 'activity_unavailable';
  end if;
  if v_actor = v_caller then
    raise exception 'cannot_like_own';
  end if;

  insert into public.social_review_likes (user_id, activity_id)
  values (v_caller, p_activity_id)
  on conflict (user_id, activity_id) do nothing;

  v_liked := true;

  select count(*)::integer into v_count
  from public.social_review_likes
  where activity_id = p_activity_id;

  perform public.social_insert_notification(
    v_actor,
    v_caller,
    'review_liked',
    'social_activity',
    p_activity_id
  );

  return jsonb_build_object(
    'activity_id', p_activity_id,
    'liked', v_liked,
    'like_count', coalesce(v_count, 0)
  );
end;
$$;

create or replace function public.unlike_review_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_actor uuid;
  v_count integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_id is null then
    raise exception 'invalid_activity';
  end if;

  -- Unlike is allowed when the like row exists even if access later changes,
  -- but we only reveal counts when the viewer can still see the activity.
  select a.actor_id into v_actor
  from public.social_activity_events as a
  where a.id = p_activity_id;

  delete from public.social_review_likes
  where user_id = v_caller
    and activity_id = p_activity_id;

  -- Remove obsolete like notification (re-like may notify again).
  delete from public.social_notifications
  where recipient_id = v_actor
    and actor_id = v_caller
    and type = 'review_liked'
    and entity_type = 'social_activity'
    and entity_id = p_activity_id;

  if not public.social_can_access_review_activity(v_caller, p_activity_id) then
    return jsonb_build_object(
      'activity_id', p_activity_id,
      'liked', false,
      'like_count', null,
      'unavailable', true
    );
  end if;

  select count(*)::integer into v_count
  from public.social_review_likes
  where activity_id = p_activity_id;

  return jsonb_build_object(
    'activity_id', p_activity_id,
    'liked', false,
    'like_count', coalesce(v_count, 0)
  );
end;
$$;

revoke all on function public.like_review_activity(uuid) from public, anon;
revoke all on function public.unlike_review_activity(uuid) from public, anon;
grant execute on function public.like_review_activity(uuid) to authenticated, service_role;
grant execute on function public.unlike_review_activity(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Interaction summary + discussion header
-- ---------------------------------------------------------------------------
create or replace function public.get_review_interaction_summary(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row record;
  v_like_count integer;
  v_comment_count integer;
  v_liked boolean;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_id is null then
    raise exception 'invalid_activity';
  end if;
  if not public.social_can_access_review_activity(v_caller, p_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  select
    a.id,
    a.activity_type,
    a.media_type,
    a.media_id,
    a.show_media_id,
    a.season_number,
    a.episode_number,
    a.rating,
    a.created_at,
    a.actor_id,
    p.username as actor_username,
    p.display_name as actor_display_name,
    p.avatar_path as actor_avatar_path,
    p.is_public as actor_is_public,
    r.review_text,
    coalesce(r.contains_spoilers, false) as review_contains_spoilers
  into v_row
  from public.social_activity_events as a
  join public.profiles as p on p.user_id = a.actor_id
  join public.user_media_reviews as r
    on r.user_id = a.actor_id
   and r.media_id = a.media_id
  where a.id = p_activity_id;

  select count(*)::integer into v_like_count
  from public.social_review_likes where activity_id = p_activity_id;

  select count(*)::integer into v_comment_count
  from public.social_review_comments where activity_id = p_activity_id;

  select exists (
    select 1 from public.social_review_likes
    where activity_id = p_activity_id and user_id = v_caller
  ) into v_liked;

  return jsonb_build_object(
    'id', v_row.id,
    'activity_type', v_row.activity_type,
    'media_type', v_row.media_type,
    'media_id', v_row.media_id,
    'show_media_id', v_row.show_media_id,
    'season_number', v_row.season_number,
    'episode_number', v_row.episode_number,
    'rating', v_row.rating,
    'created_at', v_row.created_at,
    'actor_user_id', v_row.actor_id,
    'actor_username', v_row.actor_username,
    'actor_display_name', v_row.actor_display_name,
    'actor_avatar_path', v_row.actor_avatar_path,
    'actor_is_public', v_row.actor_is_public,
    'review_text', v_row.review_text,
    'review_contains_spoilers', v_row.review_contains_spoilers,
    'like_count', coalesce(v_like_count, 0),
    'comment_count', coalesce(v_comment_count, 0),
    'liked_by_viewer', coalesce(v_liked, false),
    'interactions_enabled', true,
    'is_owner', v_row.actor_id = v_caller
  );
end;
$$;

revoke all on function public.get_review_interaction_summary(uuid) from public, anon;
grant execute on function public.get_review_interaction_summary(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comments list / create / delete
-- ---------------------------------------------------------------------------
create or replace function public.list_review_comments(
  p_activity_id uuid,
  p_limit integer default 30,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  activity_id uuid,
  author_id uuid,
  parent_comment_id uuid,
  comment_text text,
  contains_spoilers boolean,
  created_at timestamptz,
  updated_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_path text,
  author_is_public boolean,
  can_delete boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_size integer := least(50, greatest(1, coalesce(p_limit, 30)));
  v_owner uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_id is null then
    raise exception 'invalid_activity';
  end if;
  if not public.social_can_access_review_activity(v_caller, p_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  select a.actor_id into v_owner
  from public.social_activity_events as a
  where a.id = p_activity_id;

  return query
  select
    c.id,
    c.activity_id,
    c.author_id,
    c.parent_comment_id,
    c.comment_text,
    c.contains_spoilers,
    c.created_at,
    c.updated_at,
    p.username as author_username,
    p.display_name as author_display_name,
    p.avatar_path as author_avatar_path,
    p.is_public as author_is_public,
    (c.author_id = v_caller or v_owner = v_caller) as can_delete
  from public.social_review_comments as c
  join public.profiles as p on p.user_id = c.author_id
  where c.activity_id = p_activity_id
    and (
      p_cursor_created_at is null
      or (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id)
    )
  order by c.created_at asc, c.id asc
  limit v_size;
end;
$$;

create or replace function public.create_review_comment(
  p_activity_id uuid,
  p_comment_text text,
  p_contains_spoilers boolean default false,
  p_parent_comment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_text text := btrim(coalesce(p_comment_text, ''));
  v_owner uuid;
  v_parent record;
  v_recent integer;
  v_id uuid;
  v_created timestamptz;
  v_parent_author uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_id is null then
    raise exception 'invalid_activity';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 300 then
    raise exception 'invalid_comment';
  end if;
  if not public.social_can_access_review_activity(v_caller, p_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  select a.actor_id into v_owner
  from public.social_activity_events as a
  where a.id = p_activity_id;

  if v_owner is null then
    raise exception 'activity_unavailable';
  end if;

  -- Anti-spam: at most one new comment every 3 seconds.
  select count(*)::integer into v_recent
  from public.social_review_comments as c
  where c.author_id = v_caller
    and c.created_at > now() - interval '3 seconds';
  if coalesce(v_recent, 0) > 0 then
    raise exception 'comment_rate_limited';
  end if;

  if p_parent_comment_id is not null then
    select *
    into v_parent
    from public.social_review_comments as c
    where c.id = p_parent_comment_id;

    if v_parent.id is null then
      raise exception 'parent_unavailable';
    end if;
    if v_parent.activity_id is distinct from p_activity_id then
      raise exception 'invalid_parent';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'reply_depth_exceeded';
    end if;
    v_parent_author := v_parent.author_id;
  end if;

  insert into public.social_review_comments (
    activity_id,
    author_id,
    parent_comment_id,
    comment_text,
    contains_spoilers
  ) values (
    p_activity_id,
    v_caller,
    p_parent_comment_id,
    v_text,
    coalesce(p_contains_spoilers, false)
  )
  returning id, created_at into v_id, v_created;

  if p_parent_comment_id is null then
    perform public.social_insert_notification(
      v_owner,
      v_caller,
      'review_commented',
      'review_comment',
      v_id
    );
  else
    perform public.social_insert_notification(
      v_parent_author,
      v_caller,
      'comment_replied',
      'review_comment',
      v_id
    );
  end if;

  return jsonb_build_object(
    'id', v_id,
    'activity_id', p_activity_id,
    'author_id', v_caller,
    'parent_comment_id', p_parent_comment_id,
    'comment_text', v_text,
    'contains_spoilers', coalesce(p_contains_spoilers, false),
    'created_at', v_created,
    'can_delete', true
  );
end;
$$;

create or replace function public.delete_review_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_comment record;
  v_owner uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_comment_id is null then
    raise exception 'invalid_comment';
  end if;

  select c.* into v_comment
  from public.social_review_comments as c
  where c.id = p_comment_id;

  if v_comment.id is null then
    raise exception 'comment_unavailable';
  end if;

  select a.actor_id into v_owner
  from public.social_activity_events as a
  where a.id = v_comment.activity_id;

  -- Author or review owner may delete. Access check still required for non-authors
  -- so a guessed UUID on a private review cannot be moderated after unfollow.
  if v_comment.author_id <> v_caller and v_owner <> v_caller then
    raise exception 'not_authorized';
  end if;

  if v_comment.author_id <> v_caller then
    if not public.social_can_access_review_activity(v_caller, v_comment.activity_id) then
      raise exception 'not_authorized';
    end if;
  end if;

  delete from public.social_notifications
  where type in ('review_commented', 'comment_replied')
    and entity_type = 'review_comment'
    and entity_id in (
      select c.id
      from public.social_review_comments as c
      where c.id = p_comment_id
         or c.parent_comment_id = p_comment_id
    );

  delete from public.social_review_comments
  where id = p_comment_id;

  return true;
end;
$$;

revoke all on function public.list_review_comments(uuid, integer, timestamptz, uuid)
  from public, anon;
revoke all on function public.create_review_comment(uuid, text, boolean, uuid)
  from public, anon;
revoke all on function public.delete_review_comment(uuid) from public, anon;
grant execute on function public.list_review_comments(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;
grant execute on function public.create_review_comment(uuid, text, boolean, uuid)
  to authenticated, service_role;
grant execute on function public.delete_review_comment(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Resolve notification → discussion activity (authorized)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_review_discussion_target(
  p_entity_type text,
  p_entity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_activity_id uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_entity_id is null or p_entity_type is null then
    raise exception 'invalid_target';
  end if;

  if p_entity_type = 'social_activity' then
    v_activity_id := p_entity_id;
  elsif p_entity_type = 'review_comment' then
    select c.activity_id into v_activity_id
    from public.social_review_comments as c
    where c.id = p_entity_id;
  else
    raise exception 'invalid_target';
  end if;

  if v_activity_id is null then
    raise exception 'activity_unavailable';
  end if;
  if not public.social_can_access_review_activity(v_caller, v_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  return v_activity_id;
end;
$$;

revoke all on function public.resolve_review_discussion_target(text, uuid)
  from public, anon;
grant execute on function public.resolve_review_discussion_target(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Report content
-- ---------------------------------------------------------------------------
create or replace function public.report_social_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_id uuid;
  v_activity_id uuid;
  v_recent integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_type is null then
    raise exception 'invalid_report';
  end if;
  if p_target_type not in ('review_comment', 'social_activity') then
    raise exception 'invalid_report';
  end if;

  if p_target_type = 'social_activity' then
    v_activity_id := p_target_id;
  else
    select c.activity_id into v_activity_id
    from public.social_review_comments as c
    where c.id = p_target_id;
  end if;

  if v_activity_id is null
     or not public.social_can_access_review_activity(v_caller, v_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  select count(*)::integer into v_recent
  from public.social_content_reports as r
  where r.reporter_id = v_caller
    and r.created_at > now() - interval '1 minute';
  if coalesce(v_recent, 0) >= 5 then
    raise exception 'report_rate_limited';
  end if;

  insert into public.social_content_reports (
    reporter_id, target_type, target_id, reason
  ) values (
    v_caller, p_target_type, p_target_id, nullif(btrim(coalesce(p_reason, '')), '')
  )
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.report_social_content(text, uuid, text) from public, anon;
grant execute on function public.report_social_content(text, uuid, text)
  to authenticated, service_role;

comment on function public.like_review_activity(uuid) is
  'Idempotent like on a visible shared review activity. Notifies review owner once per actor.';
comment on function public.unlike_review_activity(uuid) is
  'Removes like and obsolete review_liked notification for the actor.';
comment on function public.create_review_comment(uuid, text, boolean, uuid) is
  'Creates a comment or one-level reply on a visible shared review. Anti-spam gated.';
