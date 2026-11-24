-- Social V2: private follow requests, discoverability opt-in, in-app notifications.
-- Additive on Social V1. Do not auto-apply; review then run manually.
-- Depends on: 20261123180000_social_profiles_and_follows.sql (profiles.is_public, profile_follows, storage bucket policies).

-- ---------------------------------------------------------------------------
-- Profile discoverability (private accounts may opt in to username search only)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists allow_profile_discovery boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_discovery_requires_username;
alter table public.profiles
  add constraint profiles_discovery_requires_username check (
    allow_profile_discovery = false
    or (username is not null and char_length(btrim(username)) >= 3)
  );

create index if not exists profiles_discovery_username_lower_idx
  on public.profiles (lower(username))
  where allow_profile_discovery = true and username is not null;

comment on column public.profiles.allow_profile_discovery is
  'When true and username is set, a private profile may appear in username search with a limited card. Does not make the profile public or expose favorites/stats/bio/banner.';

-- Active avatar only for discoverable-private profiles.
-- profiles.avatar_path stores the exact object key: {user_id}/avatar/{token}.{ext}
-- Owner access remains profile_media_select_own; public profiles remain
-- profile_media_select_public_profiles (all of their media). This policy must NOT
-- open the whole avatar folder, banners, or historical uploads.
drop policy if exists profile_media_select_discoverable_profiles on storage.objects;
create policy profile_media_select_discoverable_profiles
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-media'
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.allow_profile_discovery = true
        and profiles.is_public = false
        and profiles.username is not null
        and profiles.avatar_path is not null
        and profiles.avatar_path = name
    )
  );

-- ---------------------------------------------------------------------------
-- Follow requests
-- ---------------------------------------------------------------------------
create table if not exists public.profile_follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint profile_follow_requests_no_self check (requester_id <> target_id),
  constraint profile_follow_requests_status_check check (
    status in ('pending', 'accepted', 'rejected', 'cancelled')
  )
);

-- Concurrent request_or_follow callers serialize on this partial unique index.
create unique index if not exists profile_follow_requests_pending_unique
  on public.profile_follow_requests (requester_id, target_id)
  where status = 'pending';

create index if not exists profile_follow_requests_target_pending_idx
  on public.profile_follow_requests (target_id, created_at desc)
  where status = 'pending';

create index if not exists profile_follow_requests_requester_idx
  on public.profile_follow_requests (requester_id, created_at desc);

create index if not exists profile_follow_requests_pair_updated_idx
  on public.profile_follow_requests (requester_id, target_id, updated_at desc);

revoke all on table public.profile_follow_requests from public, anon;
grant select on table public.profile_follow_requests to authenticated, service_role;
-- Mutations only via SECURITY DEFINER RPCs.
revoke insert, update, delete on table public.profile_follow_requests from authenticated;
grant insert, update, delete on table public.profile_follow_requests to service_role;

alter table public.profile_follow_requests enable row level security;

drop policy if exists profile_follow_requests_select_participants on public.profile_follow_requests;
create policy profile_follow_requests_select_participants
  on public.profile_follow_requests
  for select
  to authenticated
  using (
    requester_id = (select auth.uid())
    or target_id = (select auth.uid())
  );

comment on table public.profile_follow_requests is
  'Pending/resolved follow requests for private targets. Direct follows still use profile_follows for public targets.';

-- ---------------------------------------------------------------------------
-- Social notifications (server-authored only)
-- ---------------------------------------------------------------------------
create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_notifications_type_check check (
    type in ('new_follower', 'follow_request', 'follow_request_accepted')
  ),
  constraint social_notifications_no_self check (recipient_id <> actor_id)
);

-- Stable per-event identity. new_follower rows are deleted on unfollow so a genuine
-- re-follow can notify again; retries of the same follow insert do not re-fire
-- because profile_follows PK / ON CONFLICT prevents a second INSERT.
alter table public.social_notifications
  drop constraint if exists social_notifications_dedupe_key;

alter table public.social_notifications
  add column if not exists dedupe_key text
  generated always as (
    recipient_id::text || ':' || type || ':' || actor_id::text || ':' || coalesce(entity_id::text, '')
  ) stored;

drop index if exists social_notifications_dedupe_idx;
drop index if exists social_notifications_dedupe_key_idx;
create unique index if not exists social_notifications_dedupe_key_idx
  on public.social_notifications (dedupe_key);

create index if not exists social_notifications_recipient_created_idx
  on public.social_notifications (recipient_id, created_at desc);

create index if not exists social_notifications_recipient_unread_idx
  on public.social_notifications (recipient_id, created_at desc)
  where read_at is null;

revoke all on table public.social_notifications from public, anon;
grant select on table public.social_notifications to authenticated, service_role;
revoke insert, update, delete on table public.social_notifications from authenticated;
grant insert, update, delete on table public.social_notifications to service_role;

alter table public.social_notifications enable row level security;

drop policy if exists social_notifications_select_own on public.social_notifications;
create policy social_notifications_select_own
  on public.social_notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

-- No authenticated UPDATE/INSERT/DELETE policies: mark-read and inserts go through DEFINER RPCs only.
drop policy if exists social_notifications_update_own_read on public.social_notifications;

comment on table public.social_notifications is
  'In-app social notifications. Inserts are server/trigger/RPC only; clients may only mark own rows read via RPC.';

-- ---------------------------------------------------------------------------
-- Helpers (internal — not granted to authenticated clients)
-- ---------------------------------------------------------------------------
create or replace function public.social_is_followable_public(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profiles
    where profiles.user_id = p_user_id
      and profiles.is_public = true
      and profiles.username is not null
  );
$$;

create or replace function public.social_is_discoverable(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profiles
    where profiles.user_id = p_user_id
      and profiles.username is not null
      and (
        profiles.is_public = true
        or profiles.allow_profile_discovery = true
      )
  );
$$;

-- True when the caller may know the target exists for relationship/list purposes:
-- public, discoverable, self, or already connected (follow or pending request either way).
create or replace function public.social_can_view_relationship(p_caller uuid, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_caller is not null
    and p_target_id is not null
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.user_id = p_target_id
        and (
          profiles.user_id = p_caller
          or (profiles.is_public = true and profiles.username is not null)
          or (profiles.allow_profile_discovery = true and profiles.username is not null)
          or exists (
            select 1 from public.profile_follows as f
            where (f.follower_id = p_caller and f.following_id = p_target_id)
               or (f.follower_id = p_target_id and f.following_id = p_caller)
          )
          or exists (
            select 1 from public.profile_follow_requests as r
            where r.status = 'pending'
              and (
                (r.requester_id = p_caller and r.target_id = p_target_id)
                or (r.requester_id = p_target_id and r.target_id = p_caller)
              )
          )
        )
    );
$$;

revoke all on function public.social_is_followable_public(uuid) from public, anon, authenticated;
revoke all on function public.social_is_discoverable(uuid) from public, anon, authenticated;
revoke all on function public.social_can_view_relationship(uuid, uuid) from public, anon, authenticated;
grant execute on function public.social_is_followable_public(uuid) to service_role;
grant execute on function public.social_is_discoverable(uuid) to service_role;
grant execute on function public.social_can_view_relationship(uuid, uuid) to service_role;

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

revoke all on function public.social_insert_notification(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.social_insert_notification(uuid, uuid, text, text, uuid) to service_role;

-- Notify on new follow edges (public follows + accepted requests).
create or replace function public.profile_follows_notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.social_insert_notification(
    new.following_id,
    new.follower_id,
    'new_follower',
    'follow',
    null
  );
  return new;
end;
$$;

drop trigger if exists profile_follows_notify_new_follower on public.profile_follows;
create trigger profile_follows_notify_new_follower
  after insert on public.profile_follows
  for each row
  execute function public.profile_follows_notify_new_follower();

revoke all on function public.profile_follows_notify_new_follower() from public, anon, authenticated;

-- Clear new_follower notification on unfollow so a later genuine re-follow can notify again.
-- Same-edge insert retries never reach this path because profile_follows PK blocks duplicates.
create or replace function public.profile_follows_cleanup_follower_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.social_notifications
  where recipient_id = old.following_id
    and actor_id = old.follower_id
    and type = 'new_follower'
    and entity_id is null;
  return old;
end;
$$;

drop trigger if exists profile_follows_cleanup_follower_notification on public.profile_follows;
create trigger profile_follows_cleanup_follower_notification
  after delete on public.profile_follows
  for each row
  execute function public.profile_follows_cleanup_follower_notification();

revoke all on function public.profile_follows_cleanup_follower_notification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Relationship / request RPCs
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
    -- Cancel any stale pending request toward this public target.
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

  -- Lightweight abuse controls (pending backlog + short re-request cooldown).
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

  -- Idempotent under concurrency: preserve existing pending request id.
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

  -- Notification only on the winning insert (entity_id = request id prevents retry dupes).
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

create or replace function public.cancel_follow_request(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_request_id uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null then
    raise exception 'invalid_target';
  end if;

  update public.profile_follow_requests
    set status = 'cancelled', updated_at = now(), resolved_at = now()
    where requester_id = v_caller
      and target_id = p_target_id
      and status = 'pending'
  returning id into v_request_id;

  if v_request_id is null then
    return false;
  end if;

  delete from public.social_notifications
  where recipient_id = p_target_id
    and actor_id = v_caller
    and type = 'follow_request'
    and entity_id = v_request_id;

  return true;
end;
$$;

revoke all on function public.cancel_follow_request(uuid) from public, anon;
grant execute on function public.cancel_follow_request(uuid) to authenticated, service_role;

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

  insert into public.profile_follows (follower_id, following_id)
  values (v_requester, v_target)
  on conflict do nothing;

  update public.profile_follow_requests
    set status = 'accepted', updated_at = now(), resolved_at = now()
    where id = p_request_id;

  -- Remove pending request notification from recipient inbox.
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

create or replace function public.reject_follow_request(p_request_id uuid)
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

  update public.profile_follow_requests
    set status = 'rejected', updated_at = now(), resolved_at = now()
    where id = p_request_id;

  delete from public.social_notifications
  where recipient_id = v_caller
    and actor_id = v_requester
    and type = 'follow_request'
    and entity_id = p_request_id;

  return true;
end;
$$;

revoke all on function public.reject_follow_request(uuid) from public, anon;
grant execute on function public.reject_follow_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- List followers / following (narrow projection)
-- ---------------------------------------------------------------------------
-- UX: owners see every connection. Public viewers only see public/discoverable
-- cards (or themselves). get_public_follow_counts for non-owners matches this
-- visible set so list length and badge counts stay consistent.
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
    where
      -- Owner may see all connections.
      p_user_id = v_caller
      -- Others only see public / discoverable cards (or themselves).
      or p.user_id = v_caller
      or p.is_public = true
      or p.allow_profile_discovery = true
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

revoke all on function public.list_follow_connections(uuid, text, integer, integer) from public, anon;
grant execute on function public.list_follow_connections(uuid, text, integer, integer) to authenticated, service_role;

-- Align public follower/following counts with the visible connection list for non-owners.
-- Owners still see true totals (including hidden private connections).
create or replace function public.get_public_follow_counts(p_user_id uuid)
returns table (
  followers integer,
  following integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;
  if not exists (
    select 1
    from public.profiles as profiles
    where profiles.user_id = p_user_id
      and (
        profiles.user_id = v_caller
        or (profiles.is_public = true and profiles.username is not null)
      )
  ) then
    raise exception 'profile_not_public';
  end if;

  v_is_owner := (p_user_id = v_caller);

  return query
  select
    (
      select count(*)::integer
      from public.profile_follows as follows
      join public.profiles as other on other.user_id = follows.follower_id
      where follows.following_id = p_user_id
        and (
          v_is_owner
          or other.user_id = v_caller
          or other.is_public = true
          or other.allow_profile_discovery = true
        )
    ) as followers,
    (
      select count(*)::integer
      from public.profile_follows as follows
      join public.profiles as other on other.user_id = follows.following_id
      where follows.follower_id = p_user_id
        and (
          v_is_owner
          or other.user_id = v_caller
          or other.is_public = true
          or other.allow_profile_discovery = true
        )
    ) as following;
end;
$$;

revoke all on function public.get_public_follow_counts(uuid) from public, anon;
grant execute on function public.get_public_follow_counts(uuid) to authenticated, service_role;

comment on function public.get_public_follow_counts(uuid) is
  'Follow counts for a public profile (or self). Non-owners only count connections that would appear in list_follow_connections (public/discoverable/self). Owners see true totals.';

-- ---------------------------------------------------------------------------
-- Discoverable search (public + opted-in private), safe projection
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
  -- Keep username charset; escape LIKE wildcards with '!' so '_' / '%' are literal.
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
    and lower(p.username) like v_pattern escape '!'
  order by p.username asc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.search_discoverable_profiles(text, integer, integer) from public, anon;
grant execute on function public.search_discoverable_profiles(text, integer, integer) to authenticated, service_role;

-- Limited private/discoverable profile card (no bio/banner/favorites/stats).
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
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if char_length(v_username) < 3 then
    raise exception 'invalid_username';
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
  where lower(p.username) = v_username
    and p.username is not null
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
grant execute on function public.get_discoverable_profile_card(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Notifications RPCs
-- ---------------------------------------------------------------------------
-- Actor projection is intentionally limited (no bio/banner/email/favorites/stats).
-- Recipients may still see actor username/display/avatar for inbox clarity even if
-- the actor later becomes fully private; signed avatar URLs still require storage policy.
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
  order by n.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.list_social_notifications(integer, integer) from public, anon;
grant execute on function public.list_social_notifications(integer, integer) to authenticated, service_role;

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
    and n.read_at is null;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_unread_social_notification_count() from public, anon;
grant execute on function public.get_unread_social_notification_count() to authenticated, service_role;

create or replace function public.mark_social_notification_read(p_notification_id uuid)
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
  if p_notification_id is null then
    raise exception 'invalid_notification';
  end if;
  update public.social_notifications
    set read_at = coalesce(read_at, now())
    where id = p_notification_id
      and recipient_id = v_caller;
  return found;
end;
$$;

revoke all on function public.mark_social_notification_read(uuid) from public, anon;
grant execute on function public.mark_social_notification_read(uuid) to authenticated, service_role;

create or replace function public.mark_all_social_notifications_read()
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
  with updated as (
    update public.social_notifications
      set read_at = now()
      where recipient_id = v_caller
        and read_at is null
    returning 1
  )
  select count(*)::integer into v_count from updated;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.mark_all_social_notifications_read() from public, anon;
grant execute on function public.mark_all_social_notifications_read() to authenticated, service_role;

create or replace function public.count_pending_follow_requests()
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
  from public.profile_follow_requests as r
  where r.target_id = v_caller
    and r.status = 'pending';
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_pending_follow_requests() from public, anon;
grant execute on function public.count_pending_follow_requests() to authenticated, service_role;
