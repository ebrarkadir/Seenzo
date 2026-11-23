-- Append-only watch logging activity for Insights Viewing Activity.
-- server_recorded_at is set by the database and is the chart-authoritative time.
-- client_logged_at is informational only and must not be treated as verified.
-- Bulk season/show marks use source season_bulk/show_bulk and are excluded from
-- ordinary monthly activity charts. Do not backfill historical watched rows.

create table public.watch_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_event_id uuid not null,
  media_type text not null,
  media_id text not null,
  show_media_id text,
  action text not null,
  source text not null,
  client_logged_at timestamptz not null,
  server_recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint watch_activity_events_user_client_key unique (user_id, client_event_id),
  constraint watch_activity_events_media_type_check check (media_type in ('movie', 'episode')),
  constraint watch_activity_events_action_check check (action in ('watched', 'unwatched')),
  constraint watch_activity_events_source_check check (
    source in ('individual', 'season_bulk', 'show_bulk', 'undo')
  ),
  constraint watch_activity_events_identity_check check (
    (
      media_type = 'movie'
      and media_id ~ '^trakt-movie-[0-9]+$'
      and show_media_id is null
    )
    or (
      media_type = 'episode'
      and media_id ~ '^trakt-episode-[0-9]+$'
      and show_media_id ~ '^trakt-show-[0-9]+$'
    )
  )
);

create index watch_activity_events_user_recorded_idx
  on public.watch_activity_events (user_id, server_recorded_at desc);

create index watch_activity_events_user_client_idx
  on public.watch_activity_events (user_id, client_event_id);

comment on table public.watch_activity_events is
  'Append-only mark-watched logging events. Not a backfill of historical progress.';

comment on column public.watch_activity_events.server_recorded_at is
  'Database timestamp used for Viewing Activity charts. Not the actual calendar watch date.';

comment on column public.watch_activity_events.client_logged_at is
  'Client-claimed log time. Informational only; never treat as server-verified.';

comment on column public.watch_activity_events.source is
  'individual counts toward monthly charts; season_bulk/show_bulk/undo are excluded.';

-- Force server-authoritative timestamps even if a privileged caller supplies values.
create or replace function public.watch_activity_events_force_server_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.server_recorded_at := now();
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.watch_activity_events_force_server_time() from public, anon, authenticated;

create trigger watch_activity_events_force_server_time
  before insert on public.watch_activity_events
  for each row
  execute function public.watch_activity_events_force_server_time();

revoke all on table public.watch_activity_events from public, anon, authenticated;
-- Authenticated clients may read their rows and insert client-owned fields only.
-- They cannot set id, server_recorded_at, or created_at (defaults + trigger).
grant select on table public.watch_activity_events to authenticated;
grant insert (
  user_id,
  client_event_id,
  media_type,
  media_id,
  show_media_id,
  action,
  source,
  client_logged_at
) on table public.watch_activity_events to authenticated;
grant select, insert, update, delete on table public.watch_activity_events to service_role;
-- No update/delete for authenticated: append-only history.

alter table public.watch_activity_events enable row level security;

create policy watch_activity_events_select_own
  on public.watch_activity_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy watch_activity_events_insert_own
  on public.watch_activity_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
