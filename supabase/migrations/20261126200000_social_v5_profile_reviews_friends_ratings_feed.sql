-- Social V5: profile reviews, friends' media ratings, filtered friends activity.
-- Additive only. Does not alter historical Social V1–V4 migration files.
--
-- Prefer new RPCs over changing list_following_activity RETURNS TABLE again
-- (V3 → reviews → V4 already changed that signature; V4 deploy may be pending).
--
-- Interaction count columns read social_review_likes / social_review_comments when
-- present (created IF NOT EXISTS so V5 works even if V4 was not applied yet).
-- Like/comment mutation RPCs remain owned by the V4 migration.
--
-- Consent equivalent to review_shared_at: a live rating activity row that was
-- published under share_activity_with_followers (no historical backfill).

-- ---------------------------------------------------------------------------
-- Ensure interaction tables exist (no-op when Social V4 already applied)
-- ---------------------------------------------------------------------------
create table if not exists public.social_review_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_id uuid not null references public.social_activity_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, activity_id)
);

create table if not exists public.social_review_comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.social_activity_events (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_comment_id uuid references public.social_review_comments (id) on delete cascade,
  comment_text text not null,
  contains_spoilers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_review_comments_text_len check (
    char_length(btrim(comment_text)) between 1 and 300
  )
);

alter table public.social_review_likes enable row level security;
alter table public.social_review_comments enable row level security;

revoke all on table public.social_review_likes from public, anon, authenticated;
revoke all on table public.social_review_comments from public, anon, authenticated;
grant select, insert, delete on table public.social_review_likes to service_role;
grant select, insert, delete, update on table public.social_review_comments to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.social_is_rating_activity_type(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('movie_rated', 'show_rated', 'episode_rated');
$$;

revoke all on function public.social_is_rating_activity_type(text) from public, anon, authenticated;
grant execute on function public.social_is_rating_activity_type(text) to service_role;

create or replace function public.social_normalize_feed_filter(p_filter text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(nullif(btrim(p_filter), ''), 'all'))
    when 'all' then 'all'
    when 'watched' then 'watched'
    when 'ratings' then 'ratings'
    when 'reviews' then 'reviews'
    else null
  end;
$$;

revoke all on function public.social_normalize_feed_filter(text) from public, anon, authenticated;
grant execute on function public.social_normalize_feed_filter(text) to service_role;

create or replace function public.social_normalize_review_media_filter(p_filter text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(nullif(btrim(p_filter), ''), 'all'))
    when 'all' then 'all'
    when 'movies' then 'movies'
    when 'shows' then 'shows'
    else null
  end;
$$;

revoke all on function public.social_normalize_review_media_filter(text)
  from public, anon, authenticated;
grant execute on function public.social_normalize_review_media_filter(text) to service_role;

-- ---------------------------------------------------------------------------
-- Filtered friends activity (versioned; does not replace list_following_activity)
-- ---------------------------------------------------------------------------
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

comment on function public.list_following_activity_filtered(text, integer, timestamptz, uuid) is
  'Follower-only friends activity with server-side filter (all|watched|ratings|reviews) applied before keyset pagination.';

-- ---------------------------------------------------------------------------
-- Profile reviews
-- ---------------------------------------------------------------------------
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

  if not v_is_owner then
    select exists (
      select 1
      from public.profile_follows as f
      where f.follower_id = v_caller
        and f.following_id = v_target
    ) into v_following;

    -- Public discoverability alone is never enough for reviews.
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

comment on function public.list_profile_reviews(text, text, integer, timestamptz, uuid) is
  'Own profile: all reviews with private/published flags. Other profiles: only currently shared rating reviews visible under approved follow + sharing + follow-since. No broad table SELECT.';

-- ---------------------------------------------------------------------------
-- Friends' ratings for a movie/show
-- ---------------------------------------------------------------------------
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
    select
      a.id as activity_id,
      a.rating,
      a.created_at,
      a.actor_id,
      p.username as actor_username,
      p.display_name as actor_display_name,
      p.avatar_path as actor_avatar_path,
      p.is_public as actor_is_public,
      case
        when r.review_text is not null and length(btrim(r.review_text)) > 0
          then r.review_text
        else null
      end as review_text,
      coalesce(r.contains_spoilers, false) as review_contains_spoilers
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
      and (
        (v_media_type = 'movie' and a.activity_type = 'movie_rated' and a.media_id = v_media_id)
        or (v_media_type = 'show' and a.activity_type = 'show_rated' and a.media_id = v_media_id)
      )
  )
  select
    avg(visible.rating)::numeric(4, 1),
    count(*)::integer
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

comment on function public.get_friends_media_ratings(text, text, integer, integer) is
  'Paginated friends'' published ratings for one movie/show plus server average. Follower + sharing + follow-since only. Never reads private ratings tables for other users.';
