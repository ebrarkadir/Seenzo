-- Security Phase 4: Basic moderation (hide content + report triage + audit).
-- Additive only. No hard-delete of user content. Operator RPCs are service_role-only.
-- Ops runbook: docs/MODERATION_OPS.md


-- ---------------------------------------------------------------------------
-- Report triage columns (preserve existing rows as open)
-- ---------------------------------------------------------------------------
alter table public.social_content_reports
  add column if not exists status text not null default 'open',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists review_note text;

alter table public.social_content_reports
  drop constraint if exists social_content_reports_status_check;

alter table public.social_content_reports
  add constraint social_content_reports_status_check
  check (status in ('open', 'reviewed', 'actioned', 'dismissed'));

alter table public.social_content_reports
  drop constraint if exists social_content_reports_review_note_len;

alter table public.social_content_reports
  add constraint social_content_reports_review_note_len
  check (review_note is null or char_length(review_note) <= 500);

create index if not exists social_content_reports_status_created_idx
  on public.social_content_reports (status, created_at desc);

-- Operators need UPDATE for triage fields (select/insert already granted in V4).
grant select, insert, update on table public.social_content_reports to service_role;

-- ---------------------------------------------------------------------------
-- Soft-hide flags on content (no hard delete)
-- ---------------------------------------------------------------------------
alter table public.social_activity_events
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_by text;

alter table public.social_review_comments
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_by text;

create index if not exists social_activity_events_moderation_hidden_idx
  on public.social_activity_events (id)
  where moderation_hidden_at is not null;

create index if not exists social_review_comments_moderation_hidden_idx
  on public.social_review_comments (activity_id)
  where moderation_hidden_at is not null;

-- ---------------------------------------------------------------------------
-- Append-only moderation audit
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  operator_label text not null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  previous_state jsonb,
  new_state jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_action_check check (
    action in (
      'hide_activity',
      'unhide_activity',
      'hide_comment',
      'unhide_comment',
      'review_report'
    )
  ),
  constraint moderation_actions_target_type_check check (
    target_type in ('social_activity', 'review_comment', 'report')
  ),
  constraint moderation_actions_operator_len check (char_length(btrim(operator_label)) between 3 and 120),
  constraint moderation_actions_note_len check (note is null or char_length(note) <= 500)
);

revoke all on table public.moderation_actions from public, anon, authenticated;
grant select, insert on table public.moderation_actions to service_role;
alter table public.moderation_actions enable row level security;
-- No authenticated policies: clients cannot read or write audit rows.

create index if not exists moderation_actions_created_idx
  on public.moderation_actions (created_at desc);

create index if not exists moderation_actions_target_idx
  on public.moderation_actions (target_type, target_id, created_at desc);

comment on table public.moderation_actions is
  'Append-only moderation audit. Writable only by service_role / SQL operator RPCs.';

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.moderation_notification_target_hidden(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity_id is null or p_entity_type is null then false
    when p_entity_type = 'social_activity' then exists (
      select 1 from public.social_activity_events as a
      where a.id = p_entity_id and a.moderation_hidden_at is not null
    )
    when p_entity_type = 'review_comment' then exists (
      select 1
      from public.social_review_comments as c
      join public.social_activity_events as a on a.id = c.activity_id
      where c.id = p_entity_id
        and (
          c.moderation_hidden_at is not null
          or a.moderation_hidden_at is not null
        )
    )
    else false
  end;
$$;

revoke all on function public.moderation_notification_target_hidden(text, uuid)
  from public, anon, authenticated;
grant execute on function public.moderation_notification_target_hidden(text, uuid)
  to service_role;

create or replace function public.moderation_require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- PostgREST service_role JWT.
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  -- Supabase SQL Editor / owner session without a user JWT.
  -- Authenticated mobile clients use session_user=authenticator and are denied.
  if auth.uid() is null
     and session_user in ('postgres', 'supabase_admin') then
    return;
  end if;
  raise exception 'not_authorized';
end;
$$;

revoke all on function public.moderation_require_service_role()
  from public, anon, authenticated;
grant execute on function public.moderation_require_service_role() to service_role;

create or replace function public.moderation_write_audit(
  p_operator_label text,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_previous jsonb,
  p_new jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_label text := btrim(coalesce(p_operator_label, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.moderation_require_service_role();
  if char_length(v_label) < 3 then
    raise exception 'invalid_operator';
  end if;
  insert into public.moderation_actions (
    operator_label, action, target_type, target_id, previous_state, new_state, note
  ) values (
    v_label, p_action, p_target_type, p_target_id, p_previous, p_new, v_note
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.moderation_write_audit(text, text, text, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.moderation_write_audit(text, text, text, uuid, jsonb, jsonb, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Operator RPCs (EXECUTE: service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.moderate_hide_social_activity(
  p_activity_id uuid,
  p_operator_label text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
begin
  perform public.moderation_require_service_role();
  if p_activity_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_activity_events
  where id = p_activity_id
  for update;

  if not found then
    raise exception 'activity_unavailable';
  end if;

  update public.social_activity_events
    set moderation_hidden_at = coalesce(moderation_hidden_at, now()),
        moderation_hidden_by = btrim(p_operator_label)
  where id = p_activity_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'hide_activity',
    'social_activity',
    p_activity_id,
    jsonb_build_object('moderation_hidden_at', v_prev),
    jsonb_build_object('moderation_hidden_at', now()),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_unhide_social_activity(
  p_activity_id uuid,
  p_operator_label text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
begin
  perform public.moderation_require_service_role();
  if p_activity_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_activity_events
  where id = p_activity_id
  for update;

  if not found then
    raise exception 'activity_unavailable';
  end if;

  update public.social_activity_events
    set moderation_hidden_at = null,
        moderation_hidden_by = null
  where id = p_activity_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'unhide_activity',
    'social_activity',
    p_activity_id,
    jsonb_build_object('moderation_hidden_at', v_prev),
    jsonb_build_object('moderation_hidden_at', null),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_hide_review_comment(
  p_comment_id uuid,
  p_operator_label text,
  p_note text default null,
  p_include_replies boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
  v_ids uuid[];
begin
  perform public.moderation_require_service_role();
  if p_comment_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_review_comments
  where id = p_comment_id
  for update;

  if not found then
    raise exception 'comment_unavailable';
  end if;

  if coalesce(p_include_replies, true) then
    select array_agg(c.id) into v_ids
    from public.social_review_comments as c
    where c.id = p_comment_id or c.parent_comment_id = p_comment_id;
  else
    v_ids := array[p_comment_id];
  end if;

  update public.social_review_comments
    set moderation_hidden_at = coalesce(moderation_hidden_at, now()),
        moderation_hidden_by = btrim(p_operator_label)
  where id = any(v_ids);

  perform public.moderation_write_audit(
    p_operator_label,
    'hide_comment',
    'review_comment',
    p_comment_id,
    jsonb_build_object('moderation_hidden_at', v_prev, 'ids', to_jsonb(v_ids)),
    jsonb_build_object('moderation_hidden_at', now(), 'ids', to_jsonb(v_ids)),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_unhide_review_comment(
  p_comment_id uuid,
  p_operator_label text,
  p_note text default null,
  p_include_replies boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
  v_ids uuid[];
begin
  perform public.moderation_require_service_role();
  if p_comment_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_review_comments
  where id = p_comment_id
  for update;

  if not found then
    raise exception 'comment_unavailable';
  end if;

  if coalesce(p_include_replies, true) then
    select array_agg(c.id) into v_ids
    from public.social_review_comments as c
    where c.id = p_comment_id or c.parent_comment_id = p_comment_id;
  else
    v_ids := array[p_comment_id];
  end if;

  update public.social_review_comments
    set moderation_hidden_at = null,
        moderation_hidden_by = null
  where id = any(v_ids);

  perform public.moderation_write_audit(
    p_operator_label,
    'unhide_comment',
    'review_comment',
    p_comment_id,
    jsonb_build_object('moderation_hidden_at', v_prev, 'ids', to_jsonb(v_ids)),
    jsonb_build_object('moderation_hidden_at', null, 'ids', to_jsonb(v_ids)),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_review_report(
  p_report_id uuid,
  p_status text,
  p_operator_label text,
  p_review_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.social_content_reports%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  perform public.moderation_require_service_role();
  if p_report_id is null then
    raise exception 'invalid_target';
  end if;
  if v_status not in ('open', 'reviewed', 'actioned', 'dismissed') then
    raise exception 'invalid_report_status';
  end if;

  select * into v_row
  from public.social_content_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found';
  end if;

  update public.social_content_reports
    set status = v_status,
        reviewed_at = case when v_status = 'open' then null else now() end,
        reviewed_by = case when v_status = 'open' then null else btrim(p_operator_label) end,
        review_note = case when v_status = 'open' then null else v_note end
  where id = p_report_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'review_report',
    'report',
    p_report_id,
    jsonb_build_object(
      'status', v_row.status,
      'reviewed_at', v_row.reviewed_at,
      'reviewed_by', v_row.reviewed_by,
      'review_note', v_row.review_note
    ),
    jsonb_build_object(
      'status', v_status,
      'reviewed_by', btrim(p_operator_label),
      'review_note', v_note
    ),
    v_note
  );
  return true;
end;
$$;

create or replace function public.list_moderation_reports(
  p_status text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  reporter_id uuid,
  target_type text,
  target_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_size integer := least(100, greatest(1, coalesce(p_limit, 50)));
  v_from integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.moderation_require_service_role();
  if v_status not in ('open', 'reviewed', 'actioned', 'dismissed', 'all') then
    raise exception 'invalid_report_status';
  end if;

  return query
  select
    r.id,
    r.reporter_id,
    r.target_type,
    r.target_id,
    r.reason,
    r.status,
    r.created_at,
    r.reviewed_at,
    r.reviewed_by,
    r.review_note
  from public.social_content_reports as r
  where v_status = 'all' or r.status = v_status
  order by r.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.moderate_hide_social_activity(uuid, text, text) from public, anon, authenticated;
revoke all on function public.moderate_unhide_social_activity(uuid, text, text) from public, anon, authenticated;
revoke all on function public.moderate_hide_review_comment(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.moderate_unhide_review_comment(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.moderate_review_report(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.list_moderation_reports(text, integer, integer) from public, anon, authenticated;

grant execute on function public.moderate_hide_social_activity(uuid, text, text) to service_role;
grant execute on function public.moderate_unhide_social_activity(uuid, text, text) to service_role;
grant execute on function public.moderate_hide_review_comment(uuid, text, text, boolean) to service_role;
grant execute on function public.moderate_unhide_review_comment(uuid, text, text, boolean) to service_role;
grant execute on function public.moderate_review_report(uuid, text, text, text) to service_role;
grant execute on function public.list_moderation_reports(text, integer, integer) to service_role;


-- ---------------------------------------------------------------------------
-- Gate social access + feeds for hidden content
-- ---------------------------------------------------------------------------

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
        and not public.social_is_blocked(p_caller, a.actor_id)
        and a.moderation_hidden_at is null
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
    and not public.social_is_blocked(v_caller, a.actor_id)
    and a.moderation_hidden_at is null
    and (
      p_cursor_created_at is null
      or (a.created_at, a.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by a.created_at desc, a.id desc
  limit v_size;
end;
$$;

create or replace function public.list_following_activity_filtered(
  p_filter text default 'all',
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
  v_filter text := public.social_normalize_feed_filter(p_filter);
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if v_filter is null then
    raise exception 'invalid_filter';
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
    and not public.social_is_blocked(v_caller, a.actor_id)
    and a.moderation_hidden_at is null
    and (
      v_filter = 'all'
      or (v_filter = 'watched' and a.activity_type in ('movie_watched', 'episode_watched'))
      or (v_filter = 'ratings' and public.social_is_rating_activity_type(a.activity_type))
      or (
        v_filter = 'reviews'
        and public.social_is_rating_activity_type(a.activity_type)
        and r.review_text is not null
        and length(btrim(r.review_text)) > 0
      )
    )
    and (
      p_cursor_created_at is null
      or (a.created_at, a.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by a.created_at desc, a.id desc
  limit v_size;
end;
$$;

create or replace function public.get_friends_media_ratings(
  p_media_type text,
  p_media_id text,
  p_limit integer default 5,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_size integer := least(30, greatest(1, coalesce(p_limit, 5)));
  v_from integer := greatest(0, coalesce(p_offset, 0));
  v_media_type text := lower(btrim(coalesce(p_media_type, '')));
  v_media_id text := btrim(coalesce(p_media_id, ''));
  v_avg numeric;
  v_count integer;
  v_items jsonb := '[]'::jsonb;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if v_media_type not in ('movie', 'show') or v_media_id = '' then
    raise exception 'invalid_media';
  end if;
  if v_media_type = 'movie' and v_media_id !~ '^trakt-movie-[0-9]+$' then
    raise exception 'invalid_media';
  end if;
  if v_media_type = 'show' and v_media_id !~ '^trakt-show-[0-9]+$' then
    raise exception 'invalid_media';
  end if;

  with visible as (
    select a.rating
    from public.social_activity_events as a
    join public.profile_follows as f
      on f.follower_id = v_caller
     and f.following_id = a.actor_id
     and a.created_at >= f.created_at
    join public.profiles as p
      on p.user_id = a.actor_id
    where p.share_activity_with_followers = true
      and p.username is not null
      and a.rating is not null
      and not public.social_is_blocked(v_caller, a.actor_id)
      and a.moderation_hidden_at is null
      and (
        (v_media_type = 'movie' and a.activity_type = 'movie_rated' and a.media_id = v_media_id)
        or (v_media_type = 'show' and a.activity_type = 'show_rated' and a.media_id = v_media_id)
      )
  )
  select avg(visible.rating)::numeric(4, 1), count(*)::integer
  into v_avg, v_count
  from visible;

  if coalesce(v_count, 0) = 0 then
    return jsonb_build_object(
      'media_type', v_media_type,
      'media_id', v_media_id,
      'average', null,
      'rating_count', 0,
      'items', '[]'::jsonb,
      'has_more', false
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(page)::jsonb order by page.created_at desc, page.activity_id desc), '[]'::jsonb)
  into v_items
  from (
    select
      a.id as activity_id,
      a.rating,
      a.created_at,
      a.actor_id as actor_user_id,
      p.username as actor_username,
      p.display_name as actor_display_name,
      p.avatar_path as actor_avatar_path,
      p.is_public as actor_is_public,
      case
        when r.review_text is not null and length(btrim(r.review_text)) > 0
          then r.review_text
        else null
      end as review_text,
      case
        when r.review_text is not null and length(btrim(r.review_text)) > 0
          then coalesce(r.contains_spoilers, false)
        else false
      end as review_contains_spoilers,
      (
        r.review_text is not null
        and length(btrim(r.review_text)) > 0
      ) as has_review
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
    where p.share_activity_with_followers = true
      and p.username is not null
      and a.rating is not null
      and not public.social_is_blocked(v_caller, a.actor_id)
      and a.moderation_hidden_at is null
      and (
        (v_media_type = 'movie' and a.activity_type = 'movie_rated' and a.media_id = v_media_id)
        or (v_media_type = 'show' and a.activity_type = 'show_rated' and a.media_id = v_media_id)
      )
    order by a.created_at desc, a.id desc
    offset v_from
    limit v_size
  ) as page;

  return jsonb_build_object(
    'media_type', v_media_type,
    'media_id', v_media_id,
    'average', v_avg,
    'rating_count', v_count,
    'items', coalesce(v_items, '[]'::jsonb),
    'has_more', (v_from + v_size) < v_count
  );
end;
$$;

create or replace function public.list_profile_reviews(
  p_username text,
  p_media_filter text default 'all',
  p_limit integer default 20,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  activity_id uuid,
  media_type text,
  media_id text,
  show_media_id text,
  season_number integer,
  episode_number integer,
  rating numeric,
  review_text text,
  contains_spoilers boolean,
  updated_at timestamptz,
  created_at timestamptz,
  is_published boolean,
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
  v_filter text := public.social_normalize_review_media_filter(p_media_filter);
  v_target uuid;
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_is_owner boolean := false;
  v_share boolean := false;
  v_following boolean := false;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if v_username = '' or v_filter is null then
    raise exception 'invalid_profile_reviews';
  end if;

  select p.user_id, p.share_activity_with_followers
    into v_target, v_share
  from public.profiles as p
  where p.username = v_username;

  if v_target is null then
    raise exception 'profile_not_found';
  end if;

  v_is_owner := (v_target = v_caller);
  if not v_is_owner and public.social_is_blocked(v_caller, v_target) then
    raise exception 'profile_not_found';
  end if;

  if not v_is_owner then
    select exists (
      select 1
      from public.profile_follows as f
      where f.follower_id = v_caller
        and f.following_id = v_target
    ) into v_following;

    if not v_following or not coalesce(v_share, false) then
      return;
    end if;
  end if;

  return query
  select
    r.id,
    a.id as activity_id,
    r.media_type,
    r.media_id,
    r.show_media_id,
    r.season_number,
    r.episode_number,
    case
      when r.media_type = 'episode' then ee.rating::numeric
      else me.rating::numeric
    end as rating,
    r.review_text,
    r.contains_spoilers,
    r.updated_at,
    r.created_at,
    (
      coalesce(v_share, false)
      and a.id is not null
      and public.social_is_rating_activity_type(a.activity_type)
    ) as is_published,
    case
      when a.id is not null
        and length(btrim(r.review_text)) > 0
        then (
          select count(*)::integer
          from public.social_review_likes as likes
          where likes.activity_id = a.id
        )
      else 0
    end as like_count,
    case
      when a.id is not null
        and length(btrim(r.review_text)) > 0
        then (
          select count(*)::integer
          from public.social_review_comments as comments
          where comments.activity_id = a.id
        )
      else 0
    end as comment_count,
    case
      when a.id is not null
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
      a.id is not null
      and length(btrim(r.review_text)) > 0
      and (
        v_is_owner
        or (
          coalesce(v_share, false)
          and exists (
            select 1
            from public.profile_follows as f2
            where f2.follower_id = v_caller
              and f2.following_id = v_target
              and a.created_at >= f2.created_at
          )
        )
      )
    ) as interactions_enabled
  from public.user_media_reviews as r
  left join public.social_activity_events as a
    on a.actor_id = r.user_id
   and a.media_id = r.media_id
   and public.social_is_rating_activity_type(a.activity_type)
   and a.moderation_hidden_at is null
  left join public.media_entries as me
    on me.user_id = r.user_id
   and me.media_id = r.media_id
   and r.media_type in ('movie', 'show')
  left join public.episode_entries as ee
    on ee.user_id = r.user_id
   and ee.episode_id = r.media_id
   and r.media_type = 'episode'
  where r.user_id = v_target
    and length(btrim(r.review_text)) > 0
    and (
      v_filter = 'all'
      or (v_filter = 'movies' and r.media_type = 'movie')
      or (v_filter = 'shows' and r.media_type in ('show', 'episode'))
    )
    and (
      v_is_owner
      or (
        coalesce(v_share, false)
        and a.id is not null
        and exists (
          select 1
          from public.profile_follows as f3
          where f3.follower_id = v_caller
            and f3.following_id = v_target
            and a.created_at >= f3.created_at
        )
      )
    )
    and (
      p_cursor_updated_at is null
      or (r.updated_at, r.id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by r.updated_at desc, r.id desc
  limit v_size;
end;
$$;


create or replace function public.list_social_notifications(
  p_offset integer default 0,
  p_limit integer default 30
)
returns table (
  id uuid,
  type text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz,
  actor_user_id uuid,
  actor_username text,
  actor_display_name text,
  actor_avatar_path text,
  actor_is_public boolean,
  actor_allow_profile_discovery boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_from integer := greatest(0, coalesce(p_offset, 0));
  v_size integer := least(50, greatest(1, coalesce(p_limit, 30)));
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;

  return query
  select
    n.id,
    n.type,
    n.entity_type,
    n.entity_id,
    n.read_at,
    n.created_at,
    p.user_id as actor_user_id,
    p.username as actor_username,
    p.display_name as actor_display_name,
    p.avatar_path as actor_avatar_path,
    p.is_public as actor_is_public,
    p.allow_profile_discovery as actor_allow_profile_discovery
  from public.social_notifications as n
  join public.profiles as p on p.user_id = n.actor_id
  where n.recipient_id = v_caller
    and not public.social_is_blocked(v_caller, n.actor_id)
    and not public.moderation_notification_target_hidden(n.entity_type, n.entity_id)
  order by n.created_at desc
  offset v_from
  limit v_size;
end;
$$;


create or replace function public.get_unread_social_notification_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_count integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  select count(*)::integer into v_count
  from public.social_notifications as n
  where n.recipient_id = v_caller
    and n.read_at is null
    and not public.social_is_blocked(v_caller, n.actor_id)
    and not public.moderation_notification_target_hidden(n.entity_type, n.entity_id);
  return coalesce(v_count, 0);
end;
$$;


-- ---------------------------------------------------------------------------
-- Gate discussion / interactions
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
  from public.social_review_comments
  where activity_id = p_activity_id
    and moderation_hidden_at is null;

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

  if p_entity_type = 'review_comment' then
    if exists (
      select 1 from public.social_review_comments as c
      where c.id = p_entity_id
        and c.moderation_hidden_at is not null
    ) then
      raise exception 'activity_unavailable';
    end if;
  end if;
  if not public.social_can_access_review_activity(v_caller, v_activity_id) then
    raise exception 'activity_unavailable';
  end if;

  return v_activity_id;
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
    if v_parent.moderation_hidden_at is not null then
      raise exception 'activity_unavailable';
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


-- ---------------------------------------------------------------------------
-- Reports reject hidden targets
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
  v_owner uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_recent integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_type is null then
    raise exception 'invalid_report';
  end if;
  if p_target_type not in ('review_comment', 'social_activity', 'profile') then
    raise exception 'invalid_report';
  end if;
  if v_reason is not null and char_length(v_reason) > 280 then
    raise exception 'invalid_report';
  end if;

  if p_target_type = 'profile' then
    if p_target_id = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, p_target_id) then
      raise exception 'profile_not_found';
    end if;
    if not public.social_can_view_relationship(v_caller, p_target_id) then
      raise exception 'profile_not_found';
    end if;
    if not exists (
      select 1
      from public.profiles as p
      where p.user_id = p_target_id
        and p.username is not null
    ) then
      raise exception 'profile_not_found';
    end if;

  elsif p_target_type = 'social_activity' then
    select a.actor_id into v_owner
    from public.social_activity_events as a
    where a.id = p_target_id
      and a.moderation_hidden_at is null;

    if v_owner is null then
      raise exception 'activity_unavailable';
    end if;
    if v_owner = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, v_owner) then
      raise exception 'activity_unavailable';
    end if;
    if not public.social_can_access_review_activity(v_caller, p_target_id) then
      raise exception 'activity_unavailable';
    end if;

  else
    -- review_comment
    select c.activity_id, c.author_id
      into v_activity_id, v_owner
    from public.social_review_comments as c
    join public.social_activity_events as a on a.id = c.activity_id
    where c.id = p_target_id
      and c.moderation_hidden_at is null
      and a.moderation_hidden_at is null;

    if v_activity_id is null then
      raise exception 'activity_unavailable';
    end if;
    if v_owner = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, v_owner) then
      raise exception 'activity_unavailable';
    end if;
    if not public.social_can_access_review_activity(v_caller, v_activity_id) then
      raise exception 'activity_unavailable';
    end if;
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
    v_caller, p_target_type, p_target_id, v_reason
  )
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into v_id;

  if v_id is null then
    if exists (
      select 1
      from public.social_content_reports as r
      where r.reporter_id = v_caller
        and r.target_type = p_target_type
        and r.target_id = p_target_id
    ) then
      raise exception 'already_reported';
    end if;
    raise exception 'report_failed';
  end if;

  return v_id;
end;
$$;

