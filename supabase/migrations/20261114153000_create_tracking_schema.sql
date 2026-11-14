-- Seenzo personal tracking. Catalog metadata stays outside this schema.
-- Show rows store plan, watching, or dropped. Caught up and completed are
-- derived later from released episodes and are not stored.
-- Media ids are the app's provider-qualified Trakt ids, never titles.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(btrim(display_name)) between 1 and 80
  )
);

create table public.media_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null,
  provider text not null default 'trakt',
  media_id text not null,
  show_intent text,
  movie_saved boolean,
  movie_watched boolean,
  rating smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_entries_user_media_key unique (user_id, media_id),
  constraint media_entries_type_check check (media_type in ('movie', 'show')),
  constraint media_entries_provider_check check (provider = 'trakt'),
  constraint media_entries_identity_check check (
    (media_type = 'movie' and media_id ~ '^trakt-movie-[0-9]+$')
    or (media_type = 'show' and media_id ~ '^trakt-show-[0-9]+$')
  ),
  constraint media_entries_show_intent_check check (
    show_intent is null or show_intent in ('plan', 'watching', 'dropped')
  ),
  constraint media_entries_rating_check check (
    rating is null or rating between 1 and 10
  ),
  constraint media_entries_shape_check check (
    (
      media_type = 'show'
      and movie_saved is null
      and movie_watched is null
      and (show_intent is not null or rating is not null)
    )
    or (
      media_type = 'movie'
      and show_intent is null
      and movie_saved is not null
      and movie_watched is not null
      and (movie_saved or movie_watched or rating is not null)
    )
  )
);

create table public.episode_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  show_media_id text not null,
  episode_id text not null,
  season_number integer not null,
  episode_number integer not null,
  watched boolean not null default false,
  rating smallint,
  watched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint episode_entries_user_episode_key unique (user_id, episode_id),
  constraint episode_entries_user_slot_key unique (user_id, show_media_id, season_number, episode_number),
  constraint episode_entries_show_id_check check (show_media_id ~ '^trakt-show-[0-9]+$'),
  constraint episode_entries_episode_id_check check (episode_id ~ '^trakt-episode-[0-9]+$'),
  constraint episode_entries_season_check check (season_number >= 0),
  constraint episode_entries_number_check check (episode_number >= 1),
  constraint episode_entries_rating_check check (rating is null or rating between 1 and 10),
  constraint episode_entries_state_check check (watched or rating is not null),
  constraint episode_entries_watched_at_check check (watched_at is null or watched)
);

create index media_entries_user_id_idx on public.media_entries (user_id);
create index episode_entries_user_id_idx on public.episode_entries (user_id);
create index episode_entries_user_show_idx on public.episode_entries (user_id, show_media_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_media_entries_updated_at
  before update on public.media_entries
  for each row execute function public.set_updated_at();

create trigger set_episode_entries_updated_at
  before update on public.episode_entries
  for each row execute function public.set_updated_at();

create or replace function public.seenzo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.seenzo_handle_new_user() from public, anon, authenticated;

create trigger seenzo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.seenzo_handle_new_user();

insert into public.profiles (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;

revoke all on table public.profiles from public, anon;
revoke all on table public.media_entries from public, anon;
revoke all on table public.episode_entries from public, anon;

grant select, insert, update, delete on table public.profiles to authenticated, service_role;
grant select, insert, update, delete on table public.media_entries to authenticated, service_role;
grant select, insert, update, delete on table public.episode_entries to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.media_entries enable row level security;
alter table public.episode_entries enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy profiles_delete_own
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy media_entries_select_own
  on public.media_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy media_entries_insert_own
  on public.media_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy media_entries_update_own
  on public.media_entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy media_entries_delete_own
  on public.media_entries
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy episode_entries_select_own
  on public.episode_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy episode_entries_insert_own
  on public.episode_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy episode_entries_update_own
  on public.episode_entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy episode_entries_delete_own
  on public.episode_entries
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.media_entries is
  'Personal movie and TV tracking. Caught up and completed are derived, not stored.';

comment on column public.media_entries.show_intent is
  'TV only: plan, watching, or dropped. Null means the show is rated but not on a list.';

comment on column public.media_entries.movie_saved is
  'Movie only. True for To Watch and watched movies. False when the row exists only for a rating.';

comment on column public.media_entries.movie_watched is
  'Movie only. Independent of the personal rating.';

comment on table public.episode_entries is
  'Per-user episode progress and ratings. Identity is the Trakt episode id, not the title. Rows are not deleted when the show leaves media_entries.';
