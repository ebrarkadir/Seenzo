-- Persistent manual watchlist ordering for Movies (saved, not watched) and TV (plan).
-- Ordered independently per media_type. Atomic replace via set_watchlist_order with revision guard.

create table if not exists public.watchlist_order_revisions (
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint watchlist_order_revisions_pkey primary key (user_id, media_type),
  constraint watchlist_order_revisions_type_check check (media_type in ('movie', 'show')),
  constraint watchlist_order_revisions_revision_check check (revision >= 0)
);

create table if not exists public.watchlist_order_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null,
  media_id text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlist_order_items_pkey primary key (user_id, media_type, media_id),
  constraint watchlist_order_items_type_check check (media_type in ('movie', 'show')),
  constraint watchlist_order_items_position_check check (position >= 1),
  constraint watchlist_order_items_movie_id_check check (
    media_type <> 'movie' or media_id ~ '^trakt-movie-[0-9]+$'
  ),
  constraint watchlist_order_items_show_id_check check (
    media_type <> 'show' or media_id ~ '^trakt-show-[0-9]+$'
  ),
  constraint watchlist_order_items_user_type_position_key unique (user_id, media_type, position)
);

create index if not exists watchlist_order_items_user_type_idx
  on public.watchlist_order_items (user_id, media_type, position);

create index if not exists watchlist_order_revisions_user_idx
  on public.watchlist_order_revisions (user_id);

drop trigger if exists set_watchlist_order_items_updated_at on public.watchlist_order_items;
create trigger set_watchlist_order_items_updated_at
  before update on public.watchlist_order_items
  for each row
  execute function public.set_updated_at();

revoke all on table public.watchlist_order_items from public, anon;
revoke all on table public.watchlist_order_revisions from public, anon;
grant select, insert, update, delete on table public.watchlist_order_items to authenticated, service_role;
grant select, insert, update, delete on table public.watchlist_order_revisions to authenticated, service_role;

alter table public.watchlist_order_items enable row level security;
alter table public.watchlist_order_revisions enable row level security;

drop policy if exists watchlist_order_items_select_own on public.watchlist_order_items;
create policy watchlist_order_items_select_own
  on public.watchlist_order_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_items_insert_own on public.watchlist_order_items;
create policy watchlist_order_items_insert_own
  on public.watchlist_order_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_items_update_own on public.watchlist_order_items;
create policy watchlist_order_items_update_own
  on public.watchlist_order_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_items_delete_own on public.watchlist_order_items;
create policy watchlist_order_items_delete_own
  on public.watchlist_order_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_revisions_select_own on public.watchlist_order_revisions;
create policy watchlist_order_revisions_select_own
  on public.watchlist_order_revisions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_revisions_insert_own on public.watchlist_order_revisions;
create policy watchlist_order_revisions_insert_own
  on public.watchlist_order_revisions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_revisions_update_own on public.watchlist_order_revisions;
create policy watchlist_order_revisions_update_own
  on public.watchlist_order_revisions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists watchlist_order_revisions_delete_own on public.watchlist_order_revisions;
create policy watchlist_order_revisions_delete_own
  on public.watchlist_order_revisions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Atomic full-list replace with optimistic revision. Only ids that currently belong
-- on the caller's watchlist (movie saved+unwatched / show plan) are accepted.
create or replace function public.set_watchlist_order(
  p_media_type text,
  p_ordered_ids jsonb,
  p_expected_revision bigint default null
)
returns table (revision bigint, media_id text, item_position integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_dup integer;
  v_invalid integer;
  v_current_revision bigint := 0;
  v_next_revision bigint;
  v_allowed integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;
  if p_media_type is distinct from 'movie' and p_media_type is distinct from 'show' then
    raise exception 'invalid_media_type';
  end if;
  if p_ordered_ids is null or jsonb_typeof(p_ordered_ids) <> 'array' then
    raise exception 'invalid_items';
  end if;

  select count(*)::integer into v_count from jsonb_array_elements_text(p_ordered_ids);
  select count(*)::integer into v_dup
  from (
    select value as media_id
    from jsonb_array_elements_text(p_ordered_ids) as t(value)
    group by 1
    having count(*) > 1
  ) dups;
  if v_dup > 0 then
    raise exception 'duplicate_media';
  end if;

  select count(*)::integer into v_invalid
  from jsonb_array_elements_text(p_ordered_ids) as t(value)
  where value is null
    or btrim(value) = ''
    or (
      p_media_type = 'movie'
      and value !~ '^trakt-movie-[0-9]+$'
    )
    or (
      p_media_type = 'show'
      and value !~ '^trakt-show-[0-9]+$'
    );
  if v_invalid > 0 then
    raise exception 'invalid_media_id';
  end if;

  if p_media_type = 'movie' then
    select count(*)::integer into v_allowed
    from jsonb_array_elements_text(p_ordered_ids) as t(value)
    inner join public.media_entries as me
      on me.user_id = v_user_id
     and me.media_id = t.value
     and me.media_type = 'movie'
     and me.movie_saved is true
     and me.movie_watched is false;
  else
    select count(*)::integer into v_allowed
    from jsonb_array_elements_text(p_ordered_ids) as t(value)
    inner join public.media_entries as me
      on me.user_id = v_user_id
     and me.media_id = t.value
     and me.media_type = 'show'
     and me.show_intent = 'plan';
  end if;
  if v_allowed is distinct from v_count then
    raise exception 'not_on_watchlist';
  end if;

  select r.revision into v_current_revision
  from public.watchlist_order_revisions as r
  where r.user_id = v_user_id
    and r.media_type = p_media_type
  for update;

  if not found then
    v_current_revision := 0;
  end if;

  if p_expected_revision is not null and p_expected_revision is distinct from v_current_revision then
    raise exception 'stale_revision';
  end if;

  v_next_revision := v_current_revision + 1;

  insert into public.watchlist_order_revisions (user_id, media_type, revision, updated_at)
  values (v_user_id, p_media_type, v_next_revision, now())
  on conflict (user_id, media_type) do update
  set revision = excluded.revision,
      updated_at = excluded.updated_at;

  delete from public.watchlist_order_items
  where user_id = v_user_id
    and media_type = p_media_type;

  insert into public.watchlist_order_items (user_id, media_type, media_id, position)
  select
    v_user_id,
    p_media_type,
    t.value,
    t.ord::integer
  from jsonb_array_elements_text(p_ordered_ids) with ordinality as t(value, ord);

  return query
  select
    v_next_revision,
    items.media_id,
    items.position
  from public.watchlist_order_items as items
  where items.user_id = v_user_id
    and items.media_type = p_media_type
  order by items.position;
end;
$$;

-- Client maps item_position → position.

revoke all on function public.set_watchlist_order(text, jsonb, bigint) from public, anon;
grant execute on function public.set_watchlist_order(text, jsonb, bigint) to authenticated, service_role;

comment on table public.watchlist_order_items is
  'Per-user dense watchlist positions for movies (saved unwatched) and shows (plan).';
comment on table public.watchlist_order_revisions is
  'Optimistic concurrency token for set_watchlist_order per user and media_type.';
comment on function public.set_watchlist_order(text, jsonb, bigint) is
  'Atomically replace one watchlist order. Pass expected revision to reject stale overwrites.';
