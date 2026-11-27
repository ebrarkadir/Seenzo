# Seenzo moderation ops (Security Phase 4)

Minimum pre-release moderation without a mobile admin panel.

## Who can moderate

- **Allowed:** Supabase **service_role** API calls, or the **SQL Editor** as `postgres` / `supabase_admin`.
- **Denied:** `anon`, `authenticated`, and any mobile client session.
- Mobile apps must **never** embed the service_role key or call `moderate_*` / `list_moderation_reports`.

Every mutating RPC requires `p_operator_label` (3–120 chars), e.g. your email. SQL Editor has no automatic actor identity.

## How reports enter the queue

Clients call `report_social_content` (authenticated). Rows land in `public.social_content_reports` with status `open`.

- Duplicate reports from the same user on the same target raise `already_reported`.
- Self-reports and blocked-pair edge cases are rejected in the RPC.
- Operators **do not** read reports through the mobile app.

## Daily triage procedure (SQL Editor)

1. List open reports:

```sql
select *
from public.list_moderation_reports('open', 50, 0);
```

Statuses filter: `open` | `reviewed` | `actioned` | `dismissed` | `all`.

2. Open the target (activity, comment, or profile fields on the report row). Decide hide / dismiss / leave open.

3. If content must leave public surfaces, hide via RPCs below (prefer RPCs over raw `UPDATE` so audit rows are written).

4. Close the report:

```sql
select public.moderate_review_report(
  '<report_uuid>',
  'actioned',              -- or reviewed / dismissed / open
  'ops@seenzo.example',
  'Hidden activity; noted in ticket #…'
);
```

Suggested meanings:

| Status | When |
|--------|------|
| `open` | Not triaged yet |
| `reviewed` | Looked at; no hide yet / waiting |
| `actioned` | Hide (or other action) applied |
| `dismissed` | Invalid / duplicate / no violation |

## Hide / unhide a review activity

```sql
select public.moderate_hide_social_activity(
  '<activity_uuid>',
  'ops@seenzo.example',
  'CSAM report #123'
);

select public.moderate_unhide_social_activity(
  '<activity_uuid>',
  'ops@seenzo.example',
  'false positive'
);
```

Hidden activities disappear from feeds, profile reviews (for others), friends ratings, discussion, likes/comments, and related notifications (subject to existing Social + Blocking rules after unhide).

## Hide / unhide a comment

```sql
select public.moderate_hide_review_comment(
  '<comment_uuid>',
  'ops@seenzo.example',
  'harassment',
  true  -- also hide replies under the same flat thread root
);

select public.moderate_unhide_review_comment(
  '<comment_uuid>',
  'ops@seenzo.example',
  null,
  true
);
```

Reply-to-reply uses a flat `parent_comment_id` (thread root). Hiding a root with `include_replies` covers that thread; leaf `reply_to_comment_id` targets are independent rows.

## Audit log

```sql
select *
from public.moderation_actions
order by created_at desc
limit 100;
```

Append-only. No authenticated SELECT policies. Confirm every hide/unhide/report status change you care about appears here.

## First-release ops checklist (no admin UI)

1. Schedule a short daily/near-daily open-report review in SQL Editor.
2. Always set a real `p_operator_label` and a short `p_note`.
3. Prefer hide → `actioned`; false positive → unhide + `dismissed` or note in `reviewed`.
4. Do not grant service_role to phones, CI mobile builds, or Expo public env.
5. Escalate legal/CSAM outside this doc per your host/policy process; still soft-hide in-app content via these RPCs.

## Safety notes

- Soft-hide only — rows are not hard-deleted.
- Unhide restores visibility subject to existing Social + Blocking rules.
- Prefer the RPCs above over raw `UPDATE` so audit rows are written.
