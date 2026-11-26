"""Generate Security Phase 4 moderation migration from latest RPC bodies."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
def _load(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8').replace('\r\n', '\n')


blocks = _load('supabase/migrations/20261126210000_user_blocks.sql')
v4 = _load('supabase/migrations/20261126180000_social_review_interactions.sql')
report = _load('supabase/migrations/20261126220000_social_reporting_expand.sql')


def extract_fn(src: str, name: str) -> str:
    pat = rf'(create or replace function public\.{re.escape(name)}\([\s\S]*?\n\$\$;\n)'
    m = re.search(pat, src)
    if not m:
        raise SystemExit(f'missing function {name}')
    return m.group(1)


def extract_revokes_grants(src: str, name: str) -> str:
    # Best-effort: capture revoke/grant block immediately after function if present
    pat = rf'create or replace function public\.{re.escape(name)}\([\s\S]*?\n\$\$;\n((?:revoke|grant|comment)[\s\S]{{0,800}}?)(?=\ncreate or replace|\n-- -|\Z)'
    m = re.search(pat, src)
    return m.group(1).strip() + '\n' if m else ''


def patch_can_access(body: str) -> str:
    needle = 'and not public.social_is_blocked(p_caller, a.actor_id)\n'
    insert = needle + '        and a.moderation_hidden_at is null\n'
    if needle not in body:
        raise SystemExit('can_access block needle missing')
    return body.replace(needle, insert, 1)


def patch_feed_activity_hidden(body: str) -> str:
    # Indentation varies (4 vs 6 spaces) across feed/ratings queries.
    pattern = re.compile(
        r'(?P<indent>[ \t]*)and not public\.social_is_blocked\(v_caller, a\.actor_id\)\n'
    )

    def repl(match: re.Match) -> str:
        indent = match.group('indent')
        return (
            f'{indent}and not public.social_is_blocked(v_caller, a.actor_id)\n'
            f'{indent}and a.moderation_hidden_at is null\n'
        )

    out, count = pattern.subn(repl, body)
    if count == 0:
        raise SystemExit('feed block needle missing')
    return out


def patch_comment_counts(body: str) -> str:
    # Exclude hidden comments from count subqueries.
    patterns = [
        (
            'from public.social_review_comments as comments\n'
            '        where comments.activity_id = a.id',
            'from public.social_review_comments as comments\n'
            '        where comments.activity_id = a.id\n'
            '          and comments.moderation_hidden_at is null',
        ),
        (
            'from public.social_review_comments as comments\n'
            '      where comments.activity_id = a.id',
            'from public.social_review_comments as comments\n'
            '      where comments.activity_id = a.id\n'
            '        and comments.moderation_hidden_at is null',
        ),
        (
            'from public.social_review_comments where activity_id = p_activity_id',
            'from public.social_review_comments\n'
            '  where activity_id = p_activity_id\n'
            '    and moderation_hidden_at is null',
        ),
    ]
    out = body
    for old, new in patterns:
        out = out.replace(old, new)
    return out


def patch_list_comments(body: str) -> str:
    needle = 'where c.activity_id = p_activity_id\n'
    insert = (
        'where c.activity_id = p_activity_id\n'
        '    and c.moderation_hidden_at is null\n'
        '    and (\n'
        '      c.parent_comment_id is null\n'
        '      or exists (\n'
        '        select 1 from public.social_review_comments as parent\n'
        '        where parent.id = c.parent_comment_id\n'
        '          and parent.moderation_hidden_at is null\n'
        '      )\n'
        '    )\n'
    )
    if needle not in body:
        raise SystemExit('list comments where missing')
    return body.replace(needle, insert, 1)


def patch_resolve(body: str) -> str:
    extra = '''
  if p_entity_type = 'review_comment' then
    if exists (
      select 1 from public.social_review_comments as c
      where c.id = p_entity_id
        and c.moderation_hidden_at is not null
    ) then
      raise exception 'activity_unavailable';
    end if;
  end if;
'''
    anchor = '  if v_activity_id is null then\n    raise exception \'activity_unavailable\';\n  end if;\n'
    if anchor not in body:
        raise SystemExit('resolve anchor missing')
    return body.replace(
        anchor,
        anchor + extra,
        1,
    )


def patch_create_comment(body: str) -> str:
    # After parent lookup validation, reject hidden parent.
    needle = '    if v_parent.parent_comment_id is not null then\n      raise exception \'reply_depth_exceeded\';\n    end if;'
    # Find a stable insertion after parent exists check
    marker = '  if p_parent_comment_id is not null then'
    if marker not in body:
        raise SystemExit('create comment parent marker missing')
    # Add check after selecting parent
    old = '    if v_parent.id is null or v_parent.activity_id <> p_activity_id then\n      raise exception \'invalid_parent\';\n    end if;'
    # Actual V4 text may differ - inspect
    return body  # patched below after inspection


def patch_report(body: str) -> str:
    # After activity access for activity/comment, and for profile leave as-is.
    # Add hidden checks in each branch.
    activity_branch = "  elsif p_target_type = 'social_activity' then"
    if activity_branch not in body:
        raise SystemExit('report activity branch missing')

    # Inject after selecting owner for social_activity
    old_act = '''  elsif p_target_type = 'social_activity' then
    select a.actor_id into v_owner
    from public.social_activity_events as a
    where a.id = p_target_id;

    if v_owner is null then
      raise exception 'activity_unavailable';
    end if;'''
    new_act = '''  elsif p_target_type = 'social_activity' then
    select a.actor_id into v_owner
    from public.social_activity_events as a
    where a.id = p_target_id
      and a.moderation_hidden_at is null;

    if v_owner is null then
      raise exception 'activity_unavailable';
    end if;'''
    if old_act not in body:
        raise SystemExit('report activity select missing')
    body = body.replace(old_act, new_act, 1)

    old_c = '''    select c.activity_id, c.author_id
      into v_activity_id, v_owner
    from public.social_review_comments as c
    where c.id = p_target_id;

    if v_activity_id is null then
      raise exception 'activity_unavailable';
    end if;'''
    new_c = '''    select c.activity_id, c.author_id
      into v_activity_id, v_owner
    from public.social_review_comments as c
    join public.social_activity_events as a on a.id = c.activity_id
    where c.id = p_target_id
      and c.moderation_hidden_at is null
      and a.moderation_hidden_at is null;

    if v_activity_id is null then
      raise exception 'activity_unavailable';
    end if;'''
    if old_c not in body:
        raise SystemExit('report comment select missing')
    return body.replace(old_c, new_c, 1)


def patch_notifications(body: str) -> str:
    needle = '  where n.recipient_id = v_caller\n    and not public.social_is_blocked(v_caller, n.actor_id)\n'
    insert = (
        '  where n.recipient_id = v_caller\n'
        '    and not public.social_is_blocked(v_caller, n.actor_id)\n'
        '    and not public.moderation_notification_target_hidden(n.entity_type, n.entity_id)\n'
    )
    if needle not in body:
        raise SystemExit('notifications where missing')
    return body.replace(needle, insert)


def patch_unread(body: str) -> str:
    needle = (
        '  where n.recipient_id = v_caller\n'
        '    and n.read_at is null\n'
        '    and not public.social_is_blocked(v_caller, n.actor_id);'
    )
    insert = (
        '  where n.recipient_id = v_caller\n'
        '    and n.read_at is null\n'
        '    and not public.social_is_blocked(v_caller, n.actor_id)\n'
        '    and not public.moderation_notification_target_hidden(n.entity_type, n.entity_id);'
    )
    if needle not in body:
        raise SystemExit('unread where missing')
    return body.replace(needle, insert)


HEADER = '''-- Security Phase 4: Basic moderation (hide content + report triage + audit).
-- Additive only. No hard-delete of user content. Operator RPCs are service_role-only.
-- Ops runbook: docs/MODERATION_OPS.md

'''

SCHEMA = r'''
-- ---------------------------------------------------------------------------
-- Report triage columns (preserve existing rows as open)
-- ---------------------------------------------------------------------------
alter table public.social_content_reports
  add column if not exists status text not null default 'open',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists review_note text;

alter table public.social_content_reports
  drop constraint if exists social_content_reports_status_check;

alter table public.social_content_reports
  add constraint social_content_reports_status_check
  check (status in ('open', 'reviewed', 'actioned', 'dismissed'));

alter table public.social_content_reports
  drop constraint if exists social_content_reports_review_note_len;

alter table public.social_content_reports
  add constraint social_content_reports_review_note_len
  check (review_note is null or char_length(review_note) <= 500);

create index if not exists social_content_reports_status_created_idx
  on public.social_content_reports (status, created_at desc);

-- Operators need UPDATE for triage fields (select/insert already granted in V4).
grant select, insert, update on table public.social_content_reports to service_role;

-- ---------------------------------------------------------------------------
-- Soft-hide flags on content (no hard delete)
-- ---------------------------------------------------------------------------
alter table public.social_activity_events
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_by text;

alter table public.social_review_comments
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_by text;

create index if not exists social_activity_events_moderation_hidden_idx
  on public.social_activity_events (id)
  where moderation_hidden_at is not null;

create index if not exists social_review_comments_moderation_hidden_idx
  on public.social_review_comments (activity_id)
  where moderation_hidden_at is not null;

-- ---------------------------------------------------------------------------
-- Append-only moderation audit
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  operator_label text not null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  previous_state jsonb,
  new_state jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_action_check check (
    action in (
      'hide_activity',
      'unhide_activity',
      'hide_comment',
      'unhide_comment',
      'review_report'
    )
  ),
  constraint moderation_actions_target_type_check check (
    target_type in ('social_activity', 'review_comment', 'report')
  ),
  constraint moderation_actions_operator_len check (char_length(btrim(operator_label)) between 3 and 120),
  constraint moderation_actions_note_len check (note is null or char_length(note) <= 500)
);

revoke all on table public.moderation_actions from public, anon, authenticated;
grant select, insert on table public.moderation_actions to service_role;
alter table public.moderation_actions enable row level security;
-- No authenticated policies: clients cannot read or write audit rows.

create index if not exists moderation_actions_created_idx
  on public.moderation_actions (created_at desc);

create index if not exists moderation_actions_target_idx
  on public.moderation_actions (target_type, target_id, created_at desc);

comment on table public.moderation_actions is
  'Append-only moderation audit. Writable only by service_role / SQL operator RPCs.';

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.moderation_notification_target_hidden(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity_id is null or p_entity_type is null then false
    when p_entity_type = 'social_activity' then exists (
      select 1 from public.social_activity_events as a
      where a.id = p_entity_id and a.moderation_hidden_at is not null
    )
    when p_entity_type = 'review_comment' then exists (
      select 1
      from public.social_review_comments as c
      join public.social_activity_events as a on a.id = c.activity_id
      where c.id = p_entity_id
        and (
          c.moderation_hidden_at is not null
          or a.moderation_hidden_at is not null
        )
    )
    else false
  end;
$$;

revoke all on function public.moderation_notification_target_hidden(text, uuid)
  from public, anon, authenticated;
grant execute on function public.moderation_notification_target_hidden(text, uuid)
  to service_role;

create or replace function public.moderation_require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- PostgREST service_role JWT.
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  -- Supabase SQL Editor / owner session without a user JWT.
  -- Authenticated mobile clients use session_user=authenticator and are denied.
  if auth.uid() is null
     and session_user in ('postgres', 'supabase_admin') then
    return;
  end if;
  raise exception 'not_authorized';
end;
$$;

revoke all on function public.moderation_require_service_role()
  from public, anon, authenticated;
grant execute on function public.moderation_require_service_role() to service_role;

create or replace function public.moderation_write_audit(
  p_operator_label text,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_previous jsonb,
  p_new jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_label text := btrim(coalesce(p_operator_label, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.moderation_require_service_role();
  if char_length(v_label) < 3 then
    raise exception 'invalid_operator';
  end if;
  insert into public.moderation_actions (
    operator_label, action, target_type, target_id, previous_state, new_state, note
  ) values (
    v_label, p_action, p_target_type, p_target_id, p_previous, p_new, v_note
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.moderation_write_audit(text, text, text, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.moderation_write_audit(text, text, text, uuid, jsonb, jsonb, text)
  to service_role;

'''

MOD_RPCS = r'''
-- ---------------------------------------------------------------------------
-- Operator RPCs (EXECUTE: service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.moderate_hide_social_activity(
  p_activity_id uuid,
  p_operator_label text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
begin
  perform public.moderation_require_service_role();
  if p_activity_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_activity_events
  where id = p_activity_id
  for update;

  if not found then
    raise exception 'activity_unavailable';
  end if;

  update public.social_activity_events
    set moderation_hidden_at = coalesce(moderation_hidden_at, now()),
        moderation_hidden_by = btrim(p_operator_label)
  where id = p_activity_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'hide_activity',
    'social_activity',
    p_activity_id,
    jsonb_build_object('moderation_hidden_at', v_prev),
    jsonb_build_object('moderation_hidden_at', now()),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_unhide_social_activity(
  p_activity_id uuid,
  p_operator_label text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
begin
  perform public.moderation_require_service_role();
  if p_activity_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_activity_events
  where id = p_activity_id
  for update;

  if not found then
    raise exception 'activity_unavailable';
  end if;

  update public.social_activity_events
    set moderation_hidden_at = null,
        moderation_hidden_by = null
  where id = p_activity_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'unhide_activity',
    'social_activity',
    p_activity_id,
    jsonb_build_object('moderation_hidden_at', v_prev),
    jsonb_build_object('moderation_hidden_at', null),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_hide_review_comment(
  p_comment_id uuid,
  p_operator_label text,
  p_note text default null,
  p_include_replies boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
  v_ids uuid[];
begin
  perform public.moderation_require_service_role();
  if p_comment_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_review_comments
  where id = p_comment_id
  for update;

  if not found then
    raise exception 'comment_unavailable';
  end if;

  if coalesce(p_include_replies, true) then
    select array_agg(c.id) into v_ids
    from public.social_review_comments as c
    where c.id = p_comment_id or c.parent_comment_id = p_comment_id;
  else
    v_ids := array[p_comment_id];
  end if;

  update public.social_review_comments
    set moderation_hidden_at = coalesce(moderation_hidden_at, now()),
        moderation_hidden_by = btrim(p_operator_label)
  where id = any(v_ids);

  perform public.moderation_write_audit(
    p_operator_label,
    'hide_comment',
    'review_comment',
    p_comment_id,
    jsonb_build_object('moderation_hidden_at', v_prev, 'ids', to_jsonb(v_ids)),
    jsonb_build_object('moderation_hidden_at', now(), 'ids', to_jsonb(v_ids)),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_unhide_review_comment(
  p_comment_id uuid,
  p_operator_label text,
  p_note text default null,
  p_include_replies boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
  v_ids uuid[];
begin
  perform public.moderation_require_service_role();
  if p_comment_id is null then
    raise exception 'invalid_target';
  end if;

  select moderation_hidden_at into v_prev
  from public.social_review_comments
  where id = p_comment_id
  for update;

  if not found then
    raise exception 'comment_unavailable';
  end if;

  if coalesce(p_include_replies, true) then
    select array_agg(c.id) into v_ids
    from public.social_review_comments as c
    where c.id = p_comment_id or c.parent_comment_id = p_comment_id;
  else
    v_ids := array[p_comment_id];
  end if;

  update public.social_review_comments
    set moderation_hidden_at = null,
        moderation_hidden_by = null
  where id = any(v_ids);

  perform public.moderation_write_audit(
    p_operator_label,
    'unhide_comment',
    'review_comment',
    p_comment_id,
    jsonb_build_object('moderation_hidden_at', v_prev, 'ids', to_jsonb(v_ids)),
    jsonb_build_object('moderation_hidden_at', null, 'ids', to_jsonb(v_ids)),
    p_note
  );
  return true;
end;
$$;

create or replace function public.moderate_review_report(
  p_report_id uuid,
  p_status text,
  p_operator_label text,
  p_review_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.social_content_reports%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  perform public.moderation_require_service_role();
  if p_report_id is null then
    raise exception 'invalid_target';
  end if;
  if v_status not in ('open', 'reviewed', 'actioned', 'dismissed') then
    raise exception 'invalid_report_status';
  end if;

  select * into v_row
  from public.social_content_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found';
  end if;

  update public.social_content_reports
    set status = v_status,
        reviewed_at = case when v_status = 'open' then null else now() end,
        reviewed_by = case when v_status = 'open' then null else btrim(p_operator_label) end,
        review_note = case when v_status = 'open' then null else v_note end
  where id = p_report_id;

  perform public.moderation_write_audit(
    p_operator_label,
    'review_report',
    'report',
    p_report_id,
    jsonb_build_object(
      'status', v_row.status,
      'reviewed_at', v_row.reviewed_at,
      'reviewed_by', v_row.reviewed_by,
      'review_note', v_row.review_note
    ),
    jsonb_build_object(
      'status', v_status,
      'reviewed_by', btrim(p_operator_label),
      'review_note', v_note
    ),
    v_note
  );
  return true;
end;
$$;

create or replace function public.list_moderation_reports(
  p_status text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  reporter_id uuid,
  target_type text,
  target_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_size integer := least(100, greatest(1, coalesce(p_limit, 50)));
  v_from integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.moderation_require_service_role();
  if v_status not in ('open', 'reviewed', 'actioned', 'dismissed', 'all') then
    raise exception 'invalid_report_status';
  end if;

  return query
  select
    r.id,
    r.reporter_id,
    r.target_type,
    r.target_id,
    r.reason,
    r.status,
    r.created_at,
    r.reviewed_at,
    r.reviewed_by,
    r.review_note
  from public.social_content_reports as r
  where v_status = 'all' or r.status = v_status
  order by r.created_at desc
  offset v_from
  limit v_size;
end;
$$;

revoke all on function public.moderate_hide_social_activity(uuid, text, text) from public, anon, authenticated;
revoke all on function public.moderate_unhide_social_activity(uuid, text, text) from public, anon, authenticated;
revoke all on function public.moderate_hide_review_comment(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.moderate_unhide_review_comment(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.moderate_review_report(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.list_moderation_reports(text, integer, integer) from public, anon, authenticated;

grant execute on function public.moderate_hide_social_activity(uuid, text, text) to service_role;
grant execute on function public.moderate_unhide_social_activity(uuid, text, text) to service_role;
grant execute on function public.moderate_hide_review_comment(uuid, text, text, boolean) to service_role;
grant execute on function public.moderate_unhide_review_comment(uuid, text, text, boolean) to service_role;
grant execute on function public.moderate_review_report(uuid, text, text, text) to service_role;
grant execute on function public.list_moderation_reports(text, integer, integer) to service_role;

'''


def patch_create_comment_real(body: str) -> str:
    old = '''    if v_parent.activity_id is distinct from p_activity_id then
      raise exception 'invalid_parent';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'reply_depth_exceeded';
    end if;'''
    new = '''    if v_parent.activity_id is distinct from p_activity_id then
      raise exception 'invalid_parent';
    end if;
    if v_parent.moderation_hidden_at is not null then
      raise exception 'activity_unavailable';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'reply_depth_exceeded';
    end if;'''
    if old not in body:
        raise SystemExit('create_comment parent validation block missing')
    return body.replace(old, new, 1)


def patch_summary(body: str) -> str:
    return patch_comment_counts(body)


def patch_profile_reviews(body: str) -> str:
    old_join = (
        '  left join public.social_activity_events as a\n'
        '    on a.actor_id = r.user_id\n'
        '   and a.media_id = r.media_id\n'
        '   and public.social_is_rating_activity_type(a.activity_type)\n'
    )
    new_join = (
        '  left join public.social_activity_events as a\n'
        '    on a.actor_id = r.user_id\n'
        '   and a.media_id = r.media_id\n'
        '   and public.social_is_rating_activity_type(a.activity_type)\n'
        '   and a.moderation_hidden_at is null\n'
    )
    if old_join not in body:
        raise SystemExit('profile reviews activity join missing')
    return patch_comment_counts(body.replace(old_join, new_join, 1))


parts = [HEADER, SCHEMA, MOD_RPCS]
parts.append('-- ---------------------------------------------------------------------------\n-- Gate social access + feeds for hidden content\n-- ---------------------------------------------------------------------------\n')
parts.append(patch_can_access(extract_fn(blocks, 'social_can_access_review_activity')))
parts.append('''revoke all on function public.social_can_access_review_activity(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.social_can_access_review_activity(uuid, uuid) to service_role;
''')

for name in [
    'list_following_activity',
    'list_following_activity_filtered',
    'get_friends_media_ratings',
]:
    body = patch_comment_counts(patch_feed_activity_hidden(extract_fn(blocks, name)))
    parts.append(body)
    grants = extract_revokes_grants(blocks, name)
    if grants:
        parts.append(grants)

parts.append(patch_profile_reviews(extract_fn(blocks, 'list_profile_reviews')))
parts.append(extract_revokes_grants(blocks, 'list_profile_reviews'))

# Notifications
parts.append(patch_notifications(extract_fn(blocks, 'list_social_notifications')))
parts.append(extract_revokes_grants(blocks, 'list_social_notifications'))
parts.append(patch_unread(extract_fn(blocks, 'get_unread_social_notification_count')))
parts.append(extract_revokes_grants(blocks, 'get_unread_social_notification_count'))

# V4 interaction RPCs
parts.append('-- ---------------------------------------------------------------------------\n-- Gate discussion / interactions\n-- ---------------------------------------------------------------------------\n')
parts.append(patch_list_comments(extract_fn(v4, 'list_review_comments')))
parts.append(extract_revokes_grants(v4, 'list_review_comments'))

summary = patch_summary(extract_fn(v4, 'get_review_interaction_summary'))
parts.append(summary)
parts.append(extract_revokes_grants(v4, 'get_review_interaction_summary'))

parts.append(patch_resolve(extract_fn(v4, 'resolve_review_discussion_target')))
parts.append(extract_revokes_grants(v4, 'resolve_review_discussion_target'))

parts.append(patch_create_comment_real(extract_fn(v4, 'create_review_comment')))
parts.append(extract_revokes_grants(v4, 'create_review_comment'))

# like/unlike already use social_can_access — activity hide covered.
# Still refresh grant lines only if needed.

parts.append('-- ---------------------------------------------------------------------------\n-- Reports reject hidden targets\n-- ---------------------------------------------------------------------------\n')
parts.append(patch_report(extract_fn(report, 'report_social_content')))
parts.append(extract_revokes_grants(report, 'report_social_content'))

out = ROOT / 'supabase/migrations/20261126230000_social_moderation_basic.sql'
text = '\n'.join(parts)
# Normalize accidental double newlines explosion
while '\n\n\n\n' in text:
    text = text.replace('\n\n\n\n', '\n\n\n')
out.write_text(text, encoding='utf-8')
print(f'Wrote {out} ({len(text)} bytes)')
print('hidden markers', text.count('moderation_hidden_at'))
print('moderate_hide', 'moderate_hide_social_activity' in text)
