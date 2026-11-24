-- Social V3: follower-only friends activity feed.
-- Additive on Social V2 + watch_activity_events + tracking schema.
-- Do not auto-apply; review then run manually.
--
-- Depends on:
--   20261116210000_create_watch_activity_events.sql
--   20261123180000_social_profiles_and_follows.sql
--   20261124150000_social_follow_requests_notifications.sql

-- ---------------------------------------------------------------------------
-- Consent: share watching & ratings with followers (DEFAULT OFF)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists share_activity_with_followers boolean not null default false;

comment on column public.profiles.share_activity_with_followers is
  'When true, NEW individual watches and rating changes may appear in followers'' Friends Activity. Default false. No historical backfill. Disabling hides existing rows on read.';

-- Allow episode_catchup source on Insights activity (non-social; not chart/social individual).
alter table public.watch_activity_events
  drop constraint if exists watch_activity_events_source_check;
alter table public.watch_activity_events
  add constraint watch_activity_events_source_check check (
    source in ('individual', 'season_bulk', 'show_bulk', 'undo', 'episode_catchup')
  );

comment on column public.watch_activity_events.source is
  'individual counts toward monthly charts and may publish social activity when sharing is on; season_bulk/show_bulk/undo/episode_catchup are excluded from social feed publishing.';

-- ---------------------------------------------------------------------------
-- Social activity events (followers read via RPC only)
-- ---------------------------------------------------------------------------
create table if not exists public.social_activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id) on delete cascade,
  activity_type text not null,
  media_type text not null,
  media_id text not null,
  show_media_id text,
  season_number integer,
  episode_number integer,
  rating numeric(4, 1),
  source_client_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_activity_events_type_check check (
    activity_type in (
      'movie_watched',
      'episode_watched',
      'movie_rated',
      'show_rated',
      'episode_rated'
    )
  ),
  constraint social_activity_events_media_type_check check (
    media_type in ('movie', 'show', 'episode')
  ),
  constraint social_activity_events_identity_check check (
    (
      activity_type in ('movie_watched', 'movie_rated')
      and media_type = 'movie'
      and media_id ~ '^trakt-movie-[0-9]+$'
      and show_media_id is null
      and season_number is null
      and episode_number is null
    )
    or (
      activity_type = 'show_rated'
      and media_type = 'show'
      and media_id ~ '^trakt-show-[0-9]+$'
      and show_media_id is null
      and season_number is null
      and episode_number is null
    )
    or (
      activity_type in ('episode_watched', 'episode_rated')
      and media_type = 'episode'
      and media_id ~ '^trakt-episode-[0-9]+$'
      and show_media_id ~ '^trakt-show-[0-9]+$'
    )
  ),
  constraint social_activity_events_rating_check check (
    rating is null
    or (rating >= 1 and rating <= 10 and scale(rating) <= 1)
  )
);

-- One live card per actor + activity type + media identity (rating edits update in place).
create unique index if not exists social_activity_events_actor_type_media_uidx
  on public.social_activity_events (actor_id, activity_type, media_id);

create index if not exists social_activity_events_created_idx
  on public.social_activity_events (created_at desc, id desc);

create index if not exists social_activity_events_actor_created_idx
  on public.social_activity_events (actor_id, created_at desc);

create unique index if not exists social_activity_events_source_client_uidx
  on public.social_activity_events (actor_id, source_client_event_id)
  where source_client_event_id is not null;

revoke all on table public.social_activity_events from public, anon, authenticated;
grant select, insert, update, delete on table public.social_activity_events to service_role;

alter table public.social_activity_events enable row level security;

-- No authenticated policies: clients never read/write rows directly.
drop policy if exists social_activity_events_no_direct on public.social_activity_events;

comment on table public.social_activity_events is
  'Follower-visible social activity derived from trusted tracking writes. Not a backfill of history. Direct client DML is denied.';

-- ---------------------------------------------------------------------------
-- Publish helpers (SECURITY DEFINER, locked execute)
-- ---------------------------------------------------------------------------
create or replace function public.social_activity_actor_sharing(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profiles
    where profiles.user_id = p_actor_id
      and profiles.share_activity_with_followers = true
  );
$$;

revoke all on function public.social_activity_actor_sharing(uuid) from public, anon, authenticated;
grant execute on function public.social_activity_actor_sharing(uuid) to service_role;

create or replace function public.social_upsert_activity_event(
  p_actor_id uuid,
  p_activity_type text,
  p_media_type text,
  p_media_id text,
  p_show_media_id text default null,
  p_season_number integer default null,
  p_episode_number integer default null,
  p_rating numeric default null,
  p_source_client_event_id uuid default null,
  p_bump_created_at boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_actor_id is null or p_activity_type is null or p_media_id is null then
    return null;
  end if;
  if not public.social_activity_actor_sharing(p_actor_id) then
    return null;
  end if;

  insert into public.social_activity_events (
    actor_id,
    activity_type,
    media_type,
    media_id,
    show_media_id,
    season_number,
    episode_number,
    rating,
    source_client_event_id,
    created_at,
    updated_at
  ) values (
    p_actor_id,
    p_activity_type,
    p_media_type,
    p_media_id,
    p_show_media_id,
    p_season_number,
    p_episode_number,
    p_rating,
    p_source_client_event_id,
    now(),
    now()
  )
  on conflict (actor_id, activity_type, media_id)
  do update set
    show_media_id = excluded.show_media_id,
    season_number = excluded.season_number,
    episode_number = excluded.episode_number,
    rating = excluded.rating,
    source_client_event_id = coalesce(excluded.source_client_event_id, public.social_activity_events.source_client_event_id),
    updated_at = now(),
    created_at = case
      when p_bump_created_at then now()
      else public.social_activity_events.created_at
    end
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    return null;
  when check_violation then
    return null;
end;
$$;

revoke all on function public.social_upsert_activity_event(uuid, text, text, text, text, integer, integer, numeric, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.social_upsert_activity_event(uuid, text, text, text, text, integer, integer, numeric, uuid, boolean)
  to service_role;

create or replace function public.social_delete_activity_event(
  p_actor_id uuid,
  p_activity_type text,
  p_media_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.social_activity_events
  where actor_id = p_actor_id
    and activity_type = p_activity_type
    and media_id = p_media_id;
  return found;
end;
$$;

revoke all on function public.social_delete_activity_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.social_delete_activity_event(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Watch publish trigger (individual only; no bulk / catchup / undo / history)
-- ---------------------------------------------------------------------------
create or replace function public.watch_activity_publish_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season integer;
  v_episode integer;
begin
  if new.source is distinct from 'individual' then
    return new;
  end if;

  if new.action = 'unwatched' then
    if new.media_type = 'movie' then
      perform public.social_delete_activity_event(new.user_id, 'movie_watched', new.media_id);
    elsif new.media_type = 'episode' then
      perform public.social_delete_activity_event(new.user_id, 'episode_watched', new.media_id);
    end if;
    return new;
  end if;

  if new.action is distinct from 'watched' then
    return new;
  end if;

  if new.media_type = 'movie' then
    perform public.social_upsert_activity_event(
      new.user_id,
      'movie_watched',
      'movie',
      new.media_id,
      null,
      null,
      null,
      null,
      new.client_event_id,
      true
    );
    return new;
  end if;

  if new.media_type = 'episode' then
    select e.season_number, e.episode_number
      into v_season, v_episode
    from public.episode_entries as e
    where e.user_id = new.user_id
      and e.episode_id = new.media_id
    limit 1;

    perform public.social_upsert_activity_event(
      new.user_id,
      'episode_watched',
      'episode',
      new.media_id,
      new.show_media_id,
      v_season,
      v_episode,
      null,
      new.client_event_id,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists watch_activity_publish_social on public.watch_activity_events;
create trigger watch_activity_publish_social
  after insert on public.watch_activity_events
  for each row
  execute function public.watch_activity_publish_social();

revoke all on function public.watch_activity_publish_social() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rating publish RPC (authenticated; self-only; no forge of other actors)
-- Called from intentional rating actions — not from bulk tracking sync inserts.
-- ---------------------------------------------------------------------------
create or replace function public.publish_social_rating_event(
  p_activity_type text,
  p_media_id text,
  p_show_media_id text default null,
  p_season_number integer default null,
  p_episode_number integer default null,
  p_rating numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_media_type text;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_type not in ('movie_rated', 'show_rated', 'episode_rated') then
    raise exception 'invalid_activity_type';
  end if;
  if p_media_id is null then
    raise exception 'invalid_media';
  end if;

  if p_rating is null then
    perform public.social_delete_activity_event(v_caller, p_activity_type, p_media_id);
    return null;
  end if;

  if p_rating < 1 or p_rating > 10 then
    raise exception 'invalid_rating';
  end if;

  if p_activity_type = 'movie_rated' then
    v_media_type := 'movie';
  elsif p_activity_type = 'show_rated' then
    v_media_type := 'show';
  else
    v_media_type := 'episode';
  end if;

  return public.social_upsert_activity_event(
    v_caller,
    p_activity_type,
    v_media_type,
    p_media_id,
    case when p_activity_type = 'episode_rated' then p_show_media_id else null end,
    case when p_activity_type = 'episode_rated' then p_season_number else null end,
    case when p_activity_type = 'episode_rated' then p_episode_number else null end,
    p_rating,
    null,
    false
  );
end;
$$;

revoke all on function public.publish_social_rating_event(text, text, text, integer, integer, numeric)
  from public, anon;
grant execute on function public.publish_social_rating_event(text, text, text, integer, integer, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Follower-only feed RPC (keyset pagination)
-- ---------------------------------------------------------------------------
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
  actor_is_public boolean
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
    p.is_public as actor_is_public
  from public.social_activity_events as a
  join public.profile_follows as f
    on f.follower_id = v_caller
   and f.following_id = a.actor_id
   and a.created_at >= f.created_at
  join public.profiles as p
    on p.user_id = a.actor_id
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

comment on function public.list_following_activity(integer, timestamptz, uuid) is
  'Follower-only friends activity. Requires active follow, actor sharing ON, and event created after the follow edge. No direct table access.';
