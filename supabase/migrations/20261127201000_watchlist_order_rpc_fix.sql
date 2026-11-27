-- Fix set_watchlist_order ordinality alias (WITH ORDINALITY column name).

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
  v_has_revision boolean := false;
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

  select true, r.revision
    into v_has_revision, v_current_revision
  from public.watchlist_order_revisions as r
  where r.user_id = v_user_id
    and r.media_type = p_media_type
  for update;

  if not coalesce(v_has_revision, false) then
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
