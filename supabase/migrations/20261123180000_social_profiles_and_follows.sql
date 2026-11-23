-- Social V1: public profile visibility, follows, and safe public reads.
-- Existing accounts stay private (is_public default false).
-- Do not auto-apply; run manually against the Seenzo Supabase project.

alter table public.profiles
  add column if not exists is_public boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_public_requires_username;
alter table public.profiles
  add constraint profiles_public_requires_username check (
    is_public = false
    or (username is not null and char_length(btrim(username)) >= 3)
  );

create index if not exists profiles_public_username_lower_idx
  on public.profiles (lower(username))
  where is_public = true and username is not null;

-- Authenticated users may read explicitly public profiles (no email column here).
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
  on public.profiles
  for select
  to authenticated
  using (
    is_public = true
    and username is not null
  );

-- Favorites of public profiles are readable for discovery/profile views.
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
    )
  );

-- Authenticated readers may load media objects for public profiles (signed URLs).
-- Own-object policies from the prior migration remain in place.
drop policy if exists profile_media_select_public_profiles on storage.objects;
create policy profile_media_select_public_profiles
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-media'
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.user_id::text = (storage.foldername(name))[1]
        and profiles.is_public = true
        and profiles.username is not null
    )
  );

create table if not exists public.profile_follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint profile_follows_no_self check (follower_id <> following_id)
);

create index if not exists profile_follows_following_idx
  on public.profile_follows (following_id, created_at desc);

create index if not exists profile_follows_follower_idx
  on public.profile_follows (follower_id, created_at desc);

revoke all on table public.profile_follows from public, anon;
grant select, insert, delete on table public.profile_follows to authenticated, service_role;

alter table public.profile_follows enable row level security;

-- Social V1 only needs own outgoing edges (follow state). Counts use RPCs.
-- Do not expose follower/following user IDs of unrelated public profiles.
drop policy if exists profile_follows_select_own_or_public on public.profile_follows;
drop policy if exists profile_follows_select_own on public.profile_follows;
create policy profile_follows_select_own
  on public.profile_follows
  for select
  to authenticated
  using (follower_id = (select auth.uid()));

drop policy if exists profile_follows_insert_own on public.profile_follows;
create policy profile_follows_insert_own
  on public.profile_follows
  for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and following_id <> (select auth.uid())
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.user_id = following_id
        and profiles.is_public = true
        and profiles.username is not null
    )
  );

drop policy if exists profile_follows_delete_own on public.profile_follows;
create policy profile_follows_delete_own
  on public.profile_follows
  for delete
  to authenticated
  using (follower_id = (select auth.uid()));

-- Aggregate public watch stats only. Never returns ratings, watchlists, or emails.
create or replace function public.get_public_profile_stats(p_user_id uuid)
returns table (
  movies_watched integer,
  episodes_watched integer,
  shows_tracked integer
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
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;
  if not exists (
    select 1
    from public.profiles as profiles
    where profiles.user_id = p_user_id
      and profiles.is_public = true
      and profiles.username is not null
  ) and v_caller is distinct from p_user_id then
    raise exception 'profile_not_public';
  end if;

  return query
  select
    (
      select count(*)::integer
      from public.media_entries as media
      where media.user_id = p_user_id
        and media.media_type = 'movie'
        and media.movie_watched = true
    ) as movies_watched,
    (
      select count(*)::integer
      from public.episode_entries as episodes
      where episodes.user_id = p_user_id
        and episodes.watched = true
    ) as episodes_watched,
    (
      select count(*)::integer
      from public.media_entries as media
      where media.user_id = p_user_id
        and media.media_type = 'show'
        and media.show_intent is not null
    ) as shows_tracked;
end;
$$;

revoke all on function public.get_public_profile_stats(uuid) from public, anon;
grant execute on function public.get_public_profile_stats(uuid) to authenticated, service_role;

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

  return query
  select
    (
      select count(*)::integer
      from public.profile_follows as follows
      where follows.following_id = p_user_id
    ) as followers,
    (
      select count(*)::integer
      from public.profile_follows as follows
      where follows.follower_id = p_user_id
    ) as following;
end;
$$;

revoke all on function public.get_public_follow_counts(uuid) from public, anon;
grant execute on function public.get_public_follow_counts(uuid) to authenticated, service_role;

comment on column public.profiles.is_public is
  'When true and username is set, the profile may appear in discovery and public profile views. Default false.';

comment on table public.profile_follows is
  'Directed follow edges between authenticated users. Target must be a public profile at insert time.';
