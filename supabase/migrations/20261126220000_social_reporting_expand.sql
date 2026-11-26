-- Security Phase 2: Expand social reporting to profiles.
-- Additive only. Reuses social_content_reports. Does not auto-hide or delete content.

-- ---------------------------------------------------------------------------
-- Widen target_type to include profile
-- ---------------------------------------------------------------------------
alter table public.social_content_reports
  drop constraint if exists social_content_reports_target_type_check;

alter table public.social_content_reports
  add constraint social_content_reports_target_type_check
  check (target_type in ('review_comment', 'social_activity', 'profile'));

comment on table public.social_content_reports is
  'Content reports for comments, review activities, and profiles. Intake only; no auto-moderation.';

-- ---------------------------------------------------------------------------
-- report_social_content — same signature, expanded targets + already_reported
-- ---------------------------------------------------------------------------
create or replace function public.report_social_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_id uuid;
  v_activity_id uuid;
  v_owner uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_recent integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_id is null or p_target_type is null then
    raise exception 'invalid_report';
  end if;
  if p_target_type not in ('review_comment', 'social_activity', 'profile') then
    raise exception 'invalid_report';
  end if;
  if v_reason is not null and char_length(v_reason) > 280 then
    raise exception 'invalid_report';
  end if;

  if p_target_type = 'profile' then
    if p_target_id = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, p_target_id) then
      raise exception 'profile_not_found';
    end if;
    if not public.social_can_view_relationship(v_caller, p_target_id) then
      raise exception 'profile_not_found';
    end if;
    if not exists (
      select 1
      from public.profiles as p
      where p.user_id = p_target_id
        and p.username is not null
    ) then
      raise exception 'profile_not_found';
    end if;

  elsif p_target_type = 'social_activity' then
    select a.actor_id into v_owner
    from public.social_activity_events as a
    where a.id = p_target_id;

    if v_owner is null then
      raise exception 'activity_unavailable';
    end if;
    if v_owner = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, v_owner) then
      raise exception 'activity_unavailable';
    end if;
    if not public.social_can_access_review_activity(v_caller, p_target_id) then
      raise exception 'activity_unavailable';
    end if;

  else
    -- review_comment
    select c.activity_id, c.author_id
      into v_activity_id, v_owner
    from public.social_review_comments as c
    where c.id = p_target_id;

    if v_activity_id is null then
      raise exception 'activity_unavailable';
    end if;
    if v_owner = v_caller then
      raise exception 'cannot_report_self';
    end if;
    if public.social_is_blocked(v_caller, v_owner) then
      raise exception 'activity_unavailable';
    end if;
    if not public.social_can_access_review_activity(v_caller, v_activity_id) then
      raise exception 'activity_unavailable';
    end if;
  end if;

  select count(*)::integer into v_recent
  from public.social_content_reports as r
  where r.reporter_id = v_caller
    and r.created_at > now() - interval '1 minute';
  if coalesce(v_recent, 0) >= 5 then
    raise exception 'report_rate_limited';
  end if;

  insert into public.social_content_reports (
    reporter_id, target_type, target_id, reason
  ) values (
    v_caller, p_target_type, p_target_id, v_reason
  )
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into v_id;

  if v_id is null then
    if exists (
      select 1
      from public.social_content_reports as r
      where r.reporter_id = v_caller
        and r.target_type = p_target_type
        and r.target_id = p_target_id
    ) then
      raise exception 'already_reported';
    end if;
    raise exception 'report_failed';
  end if;

  return v_id;
end;
$$;

revoke all on function public.report_social_content(text, uuid, text) from public, anon;
grant execute on function public.report_social_content(text, uuid, text)
  to authenticated, service_role;

comment on function public.report_social_content(text, uuid, text) is
  'Report a profile, shared review activity, or review comment. Deduped per reporter/target; does not hide content.';
