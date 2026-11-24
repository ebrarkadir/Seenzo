-- Social V3 corrective: reliable rating activity publishing.
-- Additive. Do not edit 20261124210000_social_activity_feed.sql.
-- Do not auto-apply; review then run manually in the SQL Editor.
--
-- Why:
--   Watched events are published by a DB trigger on watch_activity_events.
--   Rating events originally depended only on a client RPC that could silently
--   no-op (auth/session timing, episode identity, swallowed check violations).
--   This migration:
--     1) Hardens publish_social_rating_event (self-only, bump on edit).
--     2) Publishes from trusted media_entries / episode_entries UPDATE writes
--        when the rating column actually changes (no INSERT backfill).

-- ---------------------------------------------------------------------------
-- Hardened rating RPC (authenticated, self-only)
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
  v_existing numeric;
  v_bump boolean := false;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_activity_type not in ('movie_rated', 'show_rated', 'episode_rated') then
    raise exception 'invalid_activity_type';
  end if;
  if p_media_id is null or btrim(p_media_id) = '' then
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
    if p_media_id !~ '^trakt-movie-[0-9]+$' then
      raise exception 'invalid_media';
    end if;
    v_media_type := 'movie';
  elsif p_activity_type = 'show_rated' then
    if p_media_id !~ '^trakt-show-[0-9]+$' then
      raise exception 'invalid_media';
    end if;
    v_media_type := 'show';
  else
    if p_media_id !~ '^trakt-episode-[0-9]+$' then
      raise exception 'invalid_media';
    end if;
    if p_show_media_id is null or p_show_media_id !~ '^trakt-show-[0-9]+$' then
      raise exception 'invalid_show_media';
    end if;
    v_media_type := 'episode';
  end if;

  select rating
    into v_existing
  from public.social_activity_events
  where actor_id = v_caller
    and activity_type = p_activity_type
    and media_id = p_media_id
  limit 1;

  -- New rating cards and value edits float to the top; identical scores stay put.
  v_bump := v_existing is null or v_existing is distinct from p_rating;

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
    v_bump
  );
end;
$$;

revoke all on function public.publish_social_rating_event(text, text, text, integer, integer, numeric)
  from public, anon;
grant execute on function public.publish_social_rating_event(text, text, text, integer, integer, numeric)
  to authenticated, service_role;

comment on function public.publish_social_rating_event(text, text, text, integer, integer, numeric) is
  'Self-only social rating publish/delete. No-ops when share_activity_with_followers is off. Does not backfill history.';

-- ---------------------------------------------------------------------------
-- Trusted rating publish from tracking table UPDATEs (rating column only)
-- INSERT is intentionally ignored to avoid historical sync backfill.
-- ---------------------------------------------------------------------------
create or replace function public.tracking_rating_publish_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_type text;
  v_media_type text;
  v_media_id text;
  v_show_media_id text;
  v_season integer;
  v_episode integer;
  v_rating numeric;
  v_bump boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.rating is not distinct from new.rating then
    return new;
  end if;

  if tg_table_name = 'media_entries' then
    if new.media_type = 'movie' then
      v_activity_type := 'movie_rated';
      v_media_type := 'movie';
    elsif new.media_type = 'show' then
      v_activity_type := 'show_rated';
      v_media_type := 'show';
    else
      return new;
    end if;
    v_media_id := new.media_id;
    v_show_media_id := null;
    v_season := null;
    v_episode := null;
  elsif tg_table_name = 'episode_entries' then
    v_activity_type := 'episode_rated';
    v_media_type := 'episode';
    v_media_id := new.episode_id;
    v_show_media_id := new.show_media_id;
    v_season := new.season_number;
    v_episode := new.episode_number;
  else
    return new;
  end if;

  v_rating := new.rating;

  if v_rating is null then
    perform public.social_delete_activity_event(new.user_id, v_activity_type, v_media_id);
    return new;
  end if;

  v_bump := old.rating is null or old.rating is distinct from new.rating;

  perform public.social_upsert_activity_event(
    new.user_id,
    v_activity_type,
    v_media_type,
    v_media_id,
    v_show_media_id,
    v_season,
    v_episode,
    v_rating,
    null,
    v_bump
  );

  return new;
exception
  when others then
    -- Never block personal tracking writes if social publish fails.
    return new;
end;
$$;

drop trigger if exists media_entries_publish_social_rating on public.media_entries;
create trigger media_entries_publish_social_rating
  after update of rating on public.media_entries
  for each row
  execute function public.tracking_rating_publish_social();

drop trigger if exists episode_entries_publish_social_rating on public.episode_entries;
create trigger episode_entries_publish_social_rating
  after update of rating on public.episode_entries
  for each row
  execute function public.tracking_rating_publish_social();

revoke all on function public.tracking_rating_publish_social() from public, anon, authenticated;

comment on function public.tracking_rating_publish_social() is
  'Publishes/removes social rating cards when personal rating columns change. Ignores INSERT to avoid sync backfill. Respects share_activity_with_followers via social_upsert_activity_event.';
