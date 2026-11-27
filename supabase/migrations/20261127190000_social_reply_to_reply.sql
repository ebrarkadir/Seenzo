-- Social: reply-to-reply with flat visual threading.
-- parent_comment_id always points at the thread root.
-- reply_to_comment_id stores the clicked target (nullable).
-- Additive only; existing comments keep reply_to_comment_id NULL.

-- ---------------------------------------------------------------------------
-- Column + FK (SET NULL so deleting a leaf does not wipe sibling replies)
-- ---------------------------------------------------------------------------

alter table public.social_review_comments
  add column if not exists reply_to_comment_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint as c
    join pg_class as rel on rel.oid = c.conrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'social_review_comments'
      and c.conname = 'social_review_comments_reply_to_comment_id_fkey'
  ) then
    alter table public.social_review_comments
      add constraint social_review_comments_reply_to_comment_id_fkey
      foreign key (reply_to_comment_id)
      references public.social_review_comments (id)
      on delete set null;
  end if;
end;
$$;

create index if not exists social_review_comments_reply_to_idx
  on public.social_review_comments (reply_to_comment_id)
  where reply_to_comment_id is not null;

comment on column public.social_review_comments.reply_to_comment_id is
  'Clicked reply target. Visual parent remains parent_comment_id (thread root).';

-- ---------------------------------------------------------------------------
-- list_review_comments — DROP first: RETURNS TABLE signature change
-- ---------------------------------------------------------------------------

drop function if exists public.list_review_comments(uuid, integer, timestamptz, uuid);

create function public.list_review_comments(
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
  reply_to_comment_id uuid,
  comment_text text,
  contains_spoilers boolean,
  created_at timestamptz,
  updated_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_path text,
  author_is_public boolean,
  reply_to_author_username text,
  reply_to_author_display_name text,
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
    c.reply_to_comment_id,
    c.comment_text,
    c.contains_spoilers,
    c.created_at,
    c.updated_at,
    p.username as author_username,
    p.display_name as author_display_name,
    p.avatar_path as author_avatar_path,
    p.is_public as author_is_public,
    case
      when rt.id is null then null
      else rtp.username
    end as reply_to_author_username,
    case
      when rt.id is null then null
      else rtp.display_name
    end as reply_to_author_display_name,
    (c.author_id = v_caller or v_owner = v_caller) as can_delete
  from public.social_review_comments as c
  join public.profiles as p on p.user_id = c.author_id
  left join public.social_review_comments as rt
    on rt.id = c.reply_to_comment_id
   and rt.moderation_hidden_at is null
  left join public.profiles as rtp on rtp.user_id = rt.author_id
  where c.activity_id = p_activity_id
    and c.moderation_hidden_at is null
    and (
      c.parent_comment_id is null
      or exists (
        select 1 from public.social_review_comments as parent
        where parent.id = c.parent_comment_id
          and parent.moderation_hidden_at is null
      )
    )
    and (
      p_cursor_created_at is null
      or (c.created_at, c.id) > (p_cursor_created_at, p_cursor_id)
    )
  order by c.created_at asc, c.id asc
  limit v_size;
end;
$$;

revoke all on function public.list_review_comments(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_review_comments(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_review_comment — same signature; normalize parent + reply_to
-- ---------------------------------------------------------------------------

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
  v_target record;
  v_root record;
  v_recent integer;
  v_id uuid;
  v_created timestamptz;
  v_parent_id uuid := null;
  v_reply_to_id uuid := null;
  v_notify_recipient uuid := null;
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

  -- p_parent_comment_id is the clicked UI target (root or reply).
  if p_parent_comment_id is not null then
    select *
    into v_target
    from public.social_review_comments as c
    where c.id = p_parent_comment_id;

    if v_target.id is null then
      raise exception 'parent_unavailable';
    end if;
    if v_target.activity_id is distinct from p_activity_id then
      raise exception 'invalid_parent';
    end if;
    if v_target.moderation_hidden_at is not null then
      raise exception 'activity_unavailable';
    end if;

    if v_target.parent_comment_id is null then
      -- Reply to a root comment.
      v_parent_id := v_target.id;
      v_reply_to_id := null;
      v_notify_recipient := v_target.author_id;
    else
      -- Reply to a reply: flatten under the same root; remember clicked target.
      select *
      into v_root
      from public.social_review_comments as c
      where c.id = v_target.parent_comment_id;

      if v_root.id is null then
        raise exception 'parent_unavailable';
      end if;
      if v_root.activity_id is distinct from p_activity_id then
        raise exception 'invalid_parent';
      end if;
      if v_root.moderation_hidden_at is not null then
        raise exception 'activity_unavailable';
      end if;
      -- Reject malformed chains (root must itself be a root).
      if v_root.parent_comment_id is not null then
        raise exception 'invalid_parent';
      end if;

      v_parent_id := v_root.id;
      v_reply_to_id := v_target.id;
      v_notify_recipient := v_target.author_id;
    end if;
  else
    v_notify_recipient := v_owner;
  end if;

  insert into public.social_review_comments (
    activity_id,
    author_id,
    parent_comment_id,
    reply_to_comment_id,
    comment_text,
    contains_spoilers
  ) values (
    p_activity_id,
    v_caller,
    v_parent_id,
    v_reply_to_id,
    v_text,
    coalesce(p_contains_spoilers, false)
  )
  returning id, created_at into v_id, v_created;

  if v_parent_id is null then
    perform public.social_insert_notification(
      v_notify_recipient,
      v_caller,
      'review_commented',
      'review_comment',
      v_id
    );
  else
    perform public.social_insert_notification(
      v_notify_recipient,
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
    'parent_comment_id', v_parent_id,
    'reply_to_comment_id', v_reply_to_id,
    'comment_text', v_text,
    'contains_spoilers', coalesce(p_contains_spoilers, false),
    'created_at', v_created,
    'can_delete', true
  );
end;
$$;

revoke all on function public.create_review_comment(uuid, text, boolean, uuid)
  from public, anon;
grant execute on function public.create_review_comment(uuid, text, boolean, uuid)
  to authenticated, service_role;

comment on function public.create_review_comment(uuid, text, boolean, uuid) is
  'Create a review comment or reply. p_parent_comment_id is the clicked target; stored parent_comment_id is always the thread root. reply_to_comment_id holds the clicked reply when nested.';

comment on function public.list_review_comments(uuid, integer, timestamptz, uuid) is
  'List visible review comments with optional reply_to author labels for flat threading.';
