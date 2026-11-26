-- Rate & Review: private user reviews + social feed projection.
-- Additive on Social V3. Do not auto-apply; review then run manually.
--
-- Ratings remain authoritative in media_entries / episode_entries.
-- This table stores optional review text only (max 500 chars).

create table if not exists public.user_media_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null,
  media_id text not null,
  show_media_id text,
  season_number integer,
  episode_number integer,
  review_text text not null,
  contains_spoilers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_media_reviews_type_check check (
    media_type in ('movie', 'show', 'episode')
  ),
  constraint user_media_reviews_text_check check (
    char_length(btrim(review_text)) between 1 and 500
  ),
  constraint user_media_reviews_identity_check check (
    (
      media_type = 'movie'
      and media_id ~ '^trakt-movie-[0-9]+$'
      and show_media_id is null
      and season_number is null
      and episode_number is null
    )
    or (
      media_type = 'show'
      and media_id ~ '^trakt-show-[0-9]+$'
      and show_media_id is null
      and season_number is null
      and episode_number is null
    )
    or (
      media_type = 'episode'
      and media_id ~ '^trakt-episode-[0-9]+$'
      and show_media_id ~ '^trakt-show-[0-9]+$'
      and season_number is not null
      and episode_number is not null
      and season_number >= 0
      and episode_number >= 1
    )
  ),
  constraint user_media_reviews_spoiler_check check (
    contains_spoilers = false or char_length(btrim(review_text)) > 0
  )
);

create unique index if not exists user_media_reviews_user_media_uidx
  on public.user_media_reviews (user_id, media_id);

create index if not exists user_media_reviews_user_updated_idx
  on public.user_media_reviews (user_id, updated_at desc);

create or replace function public.set_user_media_reviews_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_media_reviews_set_updated_at on public.user_media_reviews;
create trigger user_media_reviews_set_updated_at
  before update on public.user_media_reviews
  for each row
  execute function public.set_user_media_reviews_updated_at();

alter table public.user_media_reviews enable row level security;

revoke all on table public.user_media_reviews from public, anon;
grant select, insert, update, delete on table public.user_media_reviews to authenticated, service_role;

drop policy if exists user_media_reviews_select_own on public.user_media_reviews;
create policy user_media_reviews_select_own
  on public.user_media_reviews
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_media_reviews_insert_own on public.user_media_reviews;
create policy user_media_reviews_insert_own
  on public.user_media_reviews
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_media_reviews_update_own on public.user_media_reviews;
create policy user_media_reviews_update_own
  on public.user_media_reviews
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_media_reviews_delete_own on public.user_media_reviews;
create policy user_media_reviews_delete_own
  on public.user_media_reviews
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.user_media_reviews is
  'Private optional reviews for rated media. Followers read text only via list_following_activity when the author has sharing enabled and an approved follow edge exists. No broad public SELECT.';

-- Extend follower feed with optional review projection (no backfill).
-- Postgres forbids CREATE OR REPLACE when RETURNS TABLE / OUT row type changes.
-- Drop by exact signature only (no CASCADE); no views/triggers depend on this RPC.
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
  review_contains_spoilers boolean
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
      when a.activity_type in ('movie_rated', 'show_rated', 'episode_rated')
        then r.review_text
      else null
    end as review_text,
    case
      when a.activity_type in ('movie_rated', 'show_rated', 'episode_rated')
        then coalesce(r.contains_spoilers, false)
      else null
    end as review_contains_spoilers
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
   and a.activity_type in ('movie_rated', 'show_rated', 'episode_rated')
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
  'Follower-only friends activity. Optional review text is included only for rating events when the author still has sharing enabled and an approved follow exists.';
