-- Profile identity fields, favorites (max 4 per media type), and private profile-media storage.
-- Do not auto-apply; run manually against the Seenzo Supabase project.

alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text,
  add column if not exists avatar_path text,
  add column if not exists banner_path text;

alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format check (
    username is null
    or username ~ '^[A-Za-z0-9_]{3,24}$'
  );

alter table public.profiles
  drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (
    bio is null or char_length(bio) <= 160
  );

alter table public.profiles
  drop constraint if exists profiles_avatar_path_format;
alter table public.profiles
  add constraint profiles_avatar_path_format check (
    avatar_path is null
    or avatar_path ~ '^[0-9a-f-]{36}/avatar/[A-Za-z0-9._-]+$'
  );

alter table public.profiles
  drop constraint if exists profiles_banner_path_format;
alter table public.profiles
  add constraint profiles_banner_path_format check (
    banner_path is null
    or banner_path ~ '^[0-9a-f-]{36}/banner/[A-Za-z0-9._-]+$'
  );

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.profile_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null,
  media_id text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_favorites_type_check check (media_type in ('movie', 'show')),
  constraint profile_favorites_position_check check (position between 1 and 4),
  constraint profile_favorites_identity_check check (
    (media_type = 'movie' and media_id ~ '^trakt-movie-[0-9]+$')
    or (media_type = 'show' and media_id ~ '^trakt-show-[0-9]+$')
  ),
  constraint profile_favorites_user_type_position_key unique (user_id, media_type, position),
  constraint profile_favorites_user_type_media_key unique (user_id, media_type, media_id)
);

create index if not exists profile_favorites_user_type_idx
  on public.profile_favorites (user_id, media_type);

drop trigger if exists set_profile_favorites_updated_at on public.profile_favorites;
create trigger set_profile_favorites_updated_at
  before update on public.profile_favorites
  for each row execute function public.set_updated_at();

revoke all on table public.profile_favorites from public, anon;
grant select, insert, update, delete on table public.profile_favorites to authenticated, service_role;

alter table public.profile_favorites enable row level security;

drop policy if exists profile_favorites_select_own on public.profile_favorites;
create policy profile_favorites_select_own
  on public.profile_favorites
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists profile_favorites_insert_own on public.profile_favorites;
create policy profile_favorites_insert_own
  on public.profile_favorites
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists profile_favorites_update_own on public.profile_favorites;
create policy profile_favorites_update_own
  on public.profile_favorites
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists profile_favorites_delete_own on public.profile_favorites;
create policy profile_favorites_delete_own
  on public.profile_favorites
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Atomic favorite replace for one media type (avoids unique position collisions).
create or replace function public.set_profile_favorites(
  p_media_type text,
  p_items jsonb
)
returns setof public.profile_favorites
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_dup_media integer;
  v_dup_pos integer;
  v_invalid integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;
  if p_media_type is distinct from 'movie' and p_media_type is distinct from 'show' then
    raise exception 'invalid_media_type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;

  select count(*)::integer into v_count from jsonb_array_elements(p_items);
  if v_count > 4 then
    raise exception 'favorites_limit';
  end if;

  select count(*)::integer into v_dup_media
  from (
    select value->>'media_id' as media_id
    from jsonb_array_elements(p_items)
    group by 1
    having count(*) > 1
  ) dups;
  if v_dup_media > 0 then
    raise exception 'duplicate_media';
  end if;

  select count(*)::integer into v_dup_pos
  from (
    select (value->>'position')::integer as position
    from jsonb_array_elements(p_items)
    group by 1
    having count(*) > 1
  ) dups;
  if v_dup_pos > 0 then
    raise exception 'duplicate_position';
  end if;

  select count(*)::integer into v_invalid
  from jsonb_array_elements(p_items) as item
  where (item.value->>'position')::integer not between 1 and 4
    or item.value->>'media_id' is null
    or (
      p_media_type = 'movie'
      and item.value->>'media_id' !~ '^trakt-movie-[0-9]+$'
    )
    or (
      p_media_type = 'show'
      and item.value->>'media_id' !~ '^trakt-show-[0-9]+$'
    );
  if v_invalid > 0 then
    raise exception 'invalid_favorite';
  end if;

  delete from public.profile_favorites
  where user_id = v_user_id
    and media_type = p_media_type;

  insert into public.profile_favorites (user_id, media_type, media_id, position)
  select
    v_user_id,
    p_media_type,
    item.value->>'media_id',
    (item.value->>'position')::smallint
  from jsonb_array_elements(p_items) as item
  order by (item.value->>'position')::integer;

  return query
  select *
  from public.profile_favorites
  where user_id = v_user_id
    and media_type = p_media_type
  order by position;
end;
$$;

revoke all on function public.set_profile_favorites(text, jsonb) from public, anon;
grant execute on function public.set_profile_favorites(text, jsonb) to authenticated, service_role;

-- Private profile media bucket. Paths: {user_id}/avatar|banner/{file}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_media_select_own on storage.objects;
create policy profile_media_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists profile_media_insert_own on storage.objects;
create policy profile_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (storage.foldername(name))[2] in ('avatar', 'banner')
  );

drop policy if exists profile_media_update_own on storage.objects;
create policy profile_media_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (storage.foldername(name))[2] in ('avatar', 'banner')
  );

drop policy if exists profile_media_delete_own on storage.objects;
create policy profile_media_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
