-- Security Phase 1: User blocking.
-- Additive only. Does not edit prior Social V1–V5 migration files.
-- Gate social read/write paths; do not delete historical likes/comments.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id, created_at desc);

create index if not exists user_blocks_blocker_created_idx
  on public.user_blocks (blocker_id, created_at desc);

revoke all on table public.user_blocks from public, anon, authenticated;
grant select, insert, delete on table public.user_blocks to service_role;

alter table public.user_blocks enable row level security;
-- No authenticated table policies: mutations/reads via SECURITY DEFINER RPCs only.

comment on table public.user_blocks is
  'Mutual social exclusion. Clients must use block_user / unblock_user / list_blocked_users RPCs.';

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
create or replace function public.social_is_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Privilege to resolve a pair:
  -- 1) JWT user is one side of the pair (RLS + user RPCs), or
  -- 2) service_role JWT (backend / privileged callers).
  -- Do NOT treat bare auth.uid() IS NULL as privileged: anon and other
  -- JWT-less sessions must not oracle arbitrary block relationships, and
  -- must not skip block checks by getting a false-negative EXISTS gate.
  select
    p_user_a is not null
    and p_user_b is not null
    and p_user_a <> p_user_b
    and (
      (
        auth.uid() is not null
        and (p_user_a = auth.uid() or p_user_b = auth.uid())
      )
      or coalesce(auth.role(), '') = 'service_role'
    )
    and exists (
      select 1
      from public.user_blocks as b
      where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
         or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
    );
$$;

revoke all on function public.social_is_blocked(uuid, uuid) from public, anon;
-- EXECUTE needed for RLS policy expressions; third-party UUID probing returns false via auth.uid() gate.
grant execute on function public.social_is_blocked(uuid, uuid)
  to authenticated, service_role;

comment on function public.social_is_blocked(uuid, uuid) is
  'Two-way block check. User JWTs may only query pairs involving auth.uid(); service_role may resolve any pair.';

-- ---------------------------------------------------------------------------
-- Block / unblock / list
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null then
    raise exception 'invalid_target';
  end if;
  if p_target_id = v_caller then
    raise exception 'cannot_block_self';
  end if;
  if not exists (select 1 from public.profiles as p where p.user_id = p_target_id) then
    raise exception 'profile_not_found';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_caller, p_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Bidirectional follow teardown.
  delete from public.profile_follows
  where (follower_id = v_caller and following_id = p_target_id)
     or (follower_id = p_target_id and following_id = v_caller);

  -- Pending requests either direction.
  update public.profile_follow_requests
    set status = 'cancelled',
        updated_at = now(),
        resolved_at = coalesce(resolved_at, now())
  where status = 'pending'
    and (
      (requester_id = v_caller and target_id = p_target_id)
      or (requester_id = p_target_id and target_id = v_caller)
    );

  -- Hide mutual inbox noise (does not delete likes/comments content rows).
  delete from public.social_notifications
  where (recipient_id = v_caller and actor_id = p_target_id)
     or (recipient_id = p_target_id and actor_id = v_caller);

  return true;
end;
$$;

create or replace function public.unblock_user(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_deleted integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_id = v_caller then
    raise exception 'invalid_target';
  end if;

  delete from public.user_blocks
  where blocker_id = v_caller
    and blocked_id = p_target_id;

  get diagnostics v_deleted = row_count;
  -- Idempotent: unblock when no row is still success (no auto-refollow).
  return true;
end;
$$;

create or replace function public.list_blocked_users(
  p_offset integer default 0,
  p_limit integer default 30
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_public boolean,
  allow_profile_discovery boolean,
  blocked_at timestamptz
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
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_path,
    p.is_public,
    p.allow_profile_discovery,
    b.created_at as blocked_at
  from public.user_blocks as b
  join public.profiles as p on p.user_id = b.blocked_id
  where b.blocker_id = v_caller
  order by b.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.list_blocked_users(integer, integer) from public, anon;
grant execute on function public.block_user(uuid) to authenticated, service_role;
grant execute on function public.unblock_user(uuid) to authenticated, service_role;
grant execute on function public.list_blocked_users(integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: public profile / favorites / follow insert respect blocks
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
  on public.profiles
  for select
  to authenticated
  using (
    is_public = true
    and username is not null
    and not public.social_is_blocked((select auth.uid()), user_id)
  );

drop policy if exists profile_favorites_select_public on public.profile_favorites;
create policy profile_favorites_select_public
  on public.profile_favorites
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles as profiles
      where profiles.user_id = profile_favorites.user_id
        and profiles.is_public = true
        and profiles.username is not null
        and not public.social_is_blocked((select auth.uid()), profiles.user_id)
    )
  );

drop policy if exists profile_follows_insert_own on public.profile_follows;
create policy profile_follows_insert_own
  on public.profile_follows
  for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and following_id <> (select auth.uid())
    and not public.social_is_blocked((select auth.uid()), following_id)
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.user_id = following_id
        and profiles.is_public = true
        and profiles.username is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Notification insert: never create rows across a block
-- ---------------------------------------------------------------------------
create or replace function public.social_insert_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type text,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_recipient_id is null or p_actor_id is null or p_type is null then
    return null;
  end if;
  if p_recipient_id = p_actor_id then
    return null;
  end if;
  if public.social_is_blocked(p_recipient_id, p_actor_id) then
    return null;
  end if;
  insert into public.social_notifications (
    recipient_id, actor_id, type, entity_type, entity_id
  ) values (
    p_recipient_id, p_actor_id, p_type, p_entity_type, p_entity_id
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    return null;
end;
$$;

revoke all on function public.social_insert_notification(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.social_insert_notification(uuid, uuid, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Follow / relationship RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_social_relationship(p_target_id uuid)
returns table (
  is_following boolean,
  follows_you boolean,
  outgoing_request_id uuid,
  incoming_request_id uuid,
  target_is_public boolean,
  target_is_discoverable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_id = v_caller then
    raise exception 'invalid_target';
  end if;
  if public.social_is_blocked(v_caller, p_target_id) then
    raise exception 'profile_not_found';
  end if;
  if not public.social_can_view_relationship(v_caller, p_target_id) then
    raise exception 'profile_not_found';
  end if;

  return query
  select
    exists (
      select 1 from public.profile_follows as f
      where f.follower_id = v_caller and f.following_id = p_target_id
    ) as is_following,
    exists (
      select 1 from public.profile_follows as f
      where f.follower_id = p_target_id and f.following_id = v_caller
    ) as follows_you,
    (
      select r.id from public.profile_follow_requests as r
      where r.requester_id = v_caller and r.target_id = p_target_id and r.status = 'pending'
      limit 1
    ) as outgoing_request_id,
    (
      select r.id from public.profile_follow_requests as r
      where r.requester_id = p_target_id and r.target_id = v_caller and r.status = 'pending'
      limit 1
    ) as incoming_request_id,
    public.social_is_followable_public(p_target_id) as target_is_public,
    public.social_is_discoverable(p_target_id) as target_is_discoverable;
end;
$$;

revoke all on function public.get_social_relationship(uuid) from public, anon;
grant execute on function public.get_social_relationship(uuid) to authenticated, service_role;

create or replace function public.request_or_follow(p_target_id uuid)
returns table (
  action text,
  request_id uuid,
  is_following boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_request_id uuid;
  v_is_public boolean;
  v_discoverable boolean;
  v_pending_count integer;
  v_last_resolved_at timestamptz;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_id = v_caller then
    raise exception 'invalid_follow';
  end if;
  if public.social_is_blocked(v_caller, p_target_id) then
    raise exception 'blocked';
  end if;
  if not exists (select 1 from public.profiles as p where p.user_id = p_target_id) then
    raise exception 'profile_not_found';
  end if;

  if exists (
    select 1 from public.profile_follows as f
    where f.follower_id = v_caller and f.following_id = p_target_id
  ) then
    return query select 'already_following'::text, null::uuid, true;
    return;
  end if;

  select public.social_is_followable_public(p_target_id), public.social_is_discoverable(p_target_id)
  into v_is_public, v_discoverable;

  if v_is_public then
    insert into public.profile_follows (follower_id, following_id)
    values (v_caller, p_target_id)
    on conflict do nothing;
    update public.profile_follow_requests
      set status = 'cancelled', updated_at = now(), resolved_at = now()
      where requester_id = v_caller
        and target_id = p_target_id
        and status = 'pending';
    return query select 'followed'::text, null::uuid, true;
    return;
  end if;

  if not v_discoverable then
    raise exception 'profile_not_discoverable';
  end if;

  select count(*)::integer into v_pending_count
  from public.profile_follow_requests as r
  where r.requester_id = v_caller
    and r.status = 'pending';
  if v_pending_count >= 30 then
    raise exception 'follow_request_limit';
  end if;

  select r.updated_at into v_last_resolved_at
  from public.profile_follow_requests as r
  where r.requester_id = v_caller
    and r.target_id = p_target_id
    and r.status in ('cancelled', 'rejected')
  order by r.updated_at desc
  limit 1;

  if v_last_resolved_at is not null
     and v_last_resolved_at > now() - interval '60 seconds' then
    raise exception 'follow_request_cooldown';
  end if;

  insert into public.profile_follow_requests (requester_id, target_id, status)
  values (v_caller, p_target_id, 'pending')
  on conflict (requester_id, target_id) where status = 'pending'
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select r.id into v_request_id
    from public.profile_follow_requests as r
    where r.requester_id = v_caller
      and r.target_id = p_target_id
      and r.status = 'pending'
    limit 1;

    return query select 'already_requested'::text, v_request_id, false;
    return;
  end if;

  perform public.social_insert_notification(
    p_target_id,
    v_caller,
    'follow_request',
    'follow_request',
    v_request_id
  );

  return query select 'requested'::text, v_request_id, false;
end;
$$;

revoke all on function public.request_or_follow(uuid) from public, anon;
grant execute on function public.request_or_follow(uuid) to authenticated, service_role;

create or replace function public.accept_follow_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_requester uuid;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request';
  end if;

  select requester_id, target_id
    into v_requester, v_target
  from public.profile_follow_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if v_requester is null then
    raise exception 'request_not_found';
  end if;
  if v_target <> v_caller then
    raise exception 'not_request_recipient';
  end if;
  -- Cancel without RAISE: an exception would roll back the cancellation.
  if public.social_is_blocked(v_caller, v_requester) then
    update public.profile_follow_requests
      set status = 'cancelled', updated_at = now(), resolved_at = now()
      where id = p_request_id;

    delete from public.social_notifications
    where recipient_id = v_caller
      and actor_id = v_requester
      and type = 'follow_request'
      and entity_id = p_request_id;

    return false;
  end if;

  insert into public.profile_follows (follower_id, following_id)
  values (v_requester, v_target)
  on conflict do nothing;

  update public.profile_follow_requests
    set status = 'accepted', updated_at = now(), resolved_at = now()
    where id = p_request_id;

  delete from public.social_notifications
  where recipient_id = v_caller
    and actor_id = v_requester
    and type = 'follow_request'
    and entity_id = p_request_id;

  perform public.social_insert_notification(
    v_requester,
    v_caller,
    'follow_request_accepted',
    'follow_request',
    p_request_id
  );

  return true;
end;
$$;

revoke all on function public.accept_follow_request(uuid) from public, anon;
grant execute on function public.accept_follow_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Search / profile card / connections / notifications
-- ---------------------------------------------------------------------------
create or replace function public.search_discoverable_profiles(
  p_query text,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_public boolean,
  allow_profile_discovery boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_raw text;
  v_pattern text;
  v_from integer := greatest(0, coalesce(p_offset, 0));
  v_size integer := least(50, greatest(1, coalesce(p_limit, 20)));
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  v_raw := lower(regexp_replace(coalesce(p_query, ''), '[^a-z0-9_]', '', 'gi'));
  if char_length(v_raw) < 1 then
    return;
  end if;
  v_pattern := '%'
    || replace(replace(replace(v_raw, '!', '!!'), '%', '!%'), '_', '!_')
    || '%';

  return query
  select
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_path,
    p.is_public,
    p.allow_profile_discovery
  from public.profiles as p
  where p.username is not null
    and p.user_id <> v_caller
    and (
      p.is_public = true
      or p.allow_profile_discovery = true
    )
    and not public.social_is_blocked(v_caller, p.user_id)
    and lower(p.username) like v_pattern escape '!'
  order by p.username asc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.search_discoverable_profiles(text, integer, integer)
  from public, anon;
grant execute on function public.search_discoverable_profiles(text, integer, integer)
  to authenticated, service_role;

create or replace function public.get_discoverable_profile_card(p_username text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_public boolean,
  allow_profile_discovery boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if char_length(v_username) < 3 then
    raise exception 'invalid_username';
  end if;

  select p.user_id into v_target
  from public.profiles as p
  where lower(p.username) = v_username
    and p.username is not null
  limit 1;

  if v_target is null then
    raise exception 'profile_not_found';
  end if;
  if v_target <> v_caller and public.social_is_blocked(v_caller, v_target) then
    raise exception 'profile_not_found';
  end if;

  return query
  select
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_path,
    p.is_public,
    p.allow_profile_discovery
  from public.profiles as p
  where p.user_id = v_target
    and (
      p.is_public = true
      or p.allow_profile_discovery = true
      or p.user_id = v_caller
    )
  limit 1;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.get_discoverable_profile_card(text) from public, anon;
grant execute on function public.get_discoverable_profile_card(text)
  to authenticated, service_role;

create or replace function public.list_follow_connections(
  p_user_id uuid,
  p_direction text,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_public boolean,
  allow_profile_discovery boolean,
  is_following boolean,
  follows_you boolean,
  outgoing_request_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_from integer := greatest(0, coalesce(p_offset, 0));
  v_size integer := least(50, greatest(1, coalesce(p_limit, 20)));
  v_owner_or_public boolean;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_user_id is null or p_direction not in ('followers', 'following') then
    raise exception 'invalid_args';
  end if;
  if p_user_id <> v_caller and public.social_is_blocked(v_caller, p_user_id) then
    raise exception 'profile_not_found';
  end if;

  select exists (
    select 1 from public.profiles as profiles
    where profiles.user_id = p_user_id
      and (
        profiles.user_id = v_caller
        or (profiles.is_public = true and profiles.username is not null)
      )
  ) into v_owner_or_public;

  if not v_owner_or_public then
    raise exception 'profile_not_public';
  end if;

  return query
  with edges as (
    select
      case when p_direction = 'followers' then f.follower_id else f.following_id end as other_id,
      f.created_at
    from public.profile_follows as f
    where (p_direction = 'followers' and f.following_id = p_user_id)
       or (p_direction = 'following' and f.follower_id = p_user_id)
  ),
  visible as (
    select e.other_id, e.created_at, p.username, p.display_name, p.avatar_path, p.is_public, p.allow_profile_discovery
    from edges as e
    join public.profiles as p on p.user_id = e.other_id
    where not public.social_is_blocked(v_caller, e.other_id)
      and (
        p_user_id = v_caller
        or p.user_id = v_caller
        or p.is_public = true
        or p.allow_profile_discovery = true
      )
  )
  select
    v.other_id as user_id,
    v.username,
    v.display_name,
    v.avatar_path,
    v.is_public,
    v.allow_profile_discovery,
    exists (
      select 1 from public.profile_follows as f
      where f.follower_id = v_caller and f.following_id = v.other_id
    ) as is_following,
    exists (
      select 1 from public.profile_follows as f
      where f.follower_id = v.other_id and f.following_id = v_caller
    ) as follows_you,
    (
      select r.id from public.profile_follow_requests as r
      where r.requester_id = v_caller and r.target_id = v.other_id and r.status = 'pending'
      limit 1
    ) as outgoing_request_id,
    v.created_at
  from visible as v
  order by v.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.list_follow_connections(uuid, text, integer, integer)
  from public, anon;
grant execute on function public.list_follow_connections(uuid, text, integer, integer)
  to authenticated, service_role;

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
  order by n.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.list_social_notifications(integer, integer) from public, anon;
grant execute on function public.list_social_notifications(integer, integer)
  to authenticated, service_role;

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
    and not public.social_is_blocked(v_caller, n.actor_id);
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_unread_social_notification_count() from public, anon;
grant execute on function public.get_unread_social_notification_count()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Activity access + feeds (V4 signature) + V5 filtered / reviews / friends
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

revoke all on function public.list_following_activity_filtered(text, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_following_activity_filtered(text, integer, timestamptz, uuid)
  to authenticated, service_role;

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

revoke all on function public.list_profile_reviews(text, text, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_profile_reviews(text, text, integer, timestamptz, uuid)
  to authenticated, service_role;

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

revoke all on function public.get_friends_media_ratings(text, text, integer, integer)
  from public, anon;
grant execute on function public.get_friends_media_ratings(text, text, integer, integer)
  to authenticated, service_role;

comment on function public.block_user(uuid) is
  'Blocks target: inserts user_blocks, removes both-direction follows/pending requests, clears mutual notifications. No like/comment content wipe.';
comment on function public.unblock_user(uuid) is
  'Removes only the caller→target block row. Does not restore follows.';
