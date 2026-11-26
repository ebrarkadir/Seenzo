# Seenzo moderation ops (Security Phase 4)

Minimum pre-release moderation without a mobile admin panel.

## Who can moderate

- **Allowed:** Supabase **service_role** API calls, or the **SQL Editor** as `postgres` / `supabase_admin`.
- **Denied:** `anon`, `authenticated`, and any mobile client session.
- Mobile apps must **never** embed the service_role key.

Every mutating RPC requires `p_operator_label` (3–120 chars), e.g. your email. SQL Editor has no automatic actor identity.

## Inspect open reports

```sql
select *
from public.list_moderation_reports('open', 50, 0);
```

Statuses: `open` | `reviewed` | `actioned` | `dismissed` | `all`.

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

Hidden activities disappear from feeds, profile reviews (for others), friends ratings, discussion, likes/comments, and related notifications.

## Hide / unhide a comment

```sql
select public.moderate_hide_review_comment(
  '<comment_uuid>',
  'ops@seenzo.example',
  'harassment',
  true  -- also hide replies
);

select public.moderate_unhide_review_comment(
  '<comment_uuid>',
  'ops@seenzo.example',
  null,
  true
);
```

## Triage a report

```sql
select public.moderate_review_report(
  '<report_uuid>',
  'actioned',              -- or reviewed / dismissed / open
  'ops@seenzo.example',
  'Hidden activity; warned user'
);
```

## Audit log

```sql
select *
from public.moderation_actions
order by created_at desc
limit 100;
```

Append-only. No authenticated SELECT policies.

## Safety notes

- Soft-hide only — rows are not hard-deleted.
- Unhide restores visibility subject to existing Social + Blocking rules.
- Prefer the RPCs above over raw `UPDATE` so audit rows are written.
