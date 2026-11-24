# Social Activity Feed — Technical Plan

**Status:** Design only. Do not implement until Social V2 follow/requests/notifications are deployed and verified.

**Audience:** Next agent implementing Following-tab friends activity.

---

## 1. Goals

Show a privacy-aware activity feed for accounts the viewer follows:

- Movie watched
- Episode watched
- Movie rated
- TV show rated
- Episode rated

Constraints:

- Default activity sharing **OFF**
- No historical backfill into the social feed
- Bulk season/show marks must not flood the feed
- Private tracking/ratings must never leak through direct table reads
- Do **not** expose `watch_activity_events` to other users

---

## 2. Current architecture (confirmed)

| Area | Location / notes |
| --- | --- |
| Local tracking source of truth | `src/tracking/TrackingContext.js` |
| Cloud sync | `src/services/supabase/trackingSync.js`, `cloudState.js` |
| Insights watch log | `public.watch_activity_events` (`20261116210000_create_watch_activity_events.sql`) |
| Ratings | Stored in tracking/media tables; personal ratings UI in `personal-ratings` |
| Follow graph | `public.profile_follows` (+ Social V2 requests) |
| Following UI shell | `src/app/(tabs)/social.js` + `ActivityFeedCard` / empty state |

`watch_activity_events` is append-only for Insights Viewing Activity. It includes `source` values `individual | season_bulk | show_bulk | undo`. Bulk/undo are excluded from ordinary monthly charts. Treat this table as **private to the owner**.

---

## 3. Recommended event model

Create a dedicated social feed table, e.g. `social_activity_events`, instead of opening `watch_activity_events` to followers.

Suggested columns:

- `id uuid pk`
- `actor_id uuid` (auth user)
- `activity_type text` (`watched_movie`, `watched_episode`, `rated_movie`, `rated_show`, `rated_episode`)
- `media_type text`, `media_id text`, optional `show_media_id`, season/episode metadata
- `rating numeric` nullable
- `created_at timestamptz` (server authoritative)
- `client_event_id uuid` unique per actor (idempotency)
- optional `visibility text` snapshot (`followers`)

Generation rules:

1. Only emit when the actor has **explicit social sharing enabled** (`share_activity_with_followers` boolean, default `false`).
2. Only emit for **future** actions after enablement (no backfill).
3. Watched events: only `source = individual` (or equivalent). Never emit season/show bulk floods.
4. Unwatch / rating removal: either delete the feed row or emit a compensating tombstone; prefer delete for simplicity.
5. Emit via trigger/SECURITY DEFINER from trusted write paths, not client inserts.

---

## 4. Read path / pagination

RPC e.g. `list_following_activity(p_offset, p_limit)`:

- `auth.uid()` required
- Join feed rows where `actor_id` is in viewer’s following set
- Actor must still allow sharing at read time **or** use immutable snapshot policy (prefer live check + existing follows)
- Return safe projection: actor card (username/display/avatar), activity type, media ids, rating, created_at
- Order by `created_at desc`
- Page size ≤ 30

Do **not** grant SELECT on the feed table to authenticated for arbitrary actors.

UI already prepared:

- `ActivityFeedCard` presentational structure
- Following empty state until API exists

---

## 5. Privacy matrix

| Actor state | Viewer is follower | Feed visible? |
| --- | --- | --- |
| Sharing OFF | yes/no | no |
| Sharing ON, public profile | yes | yes |
| Sharing ON, private profile | yes (approved follow) | yes |
| Sharing ON, private, not approved | no | no |
| Unfollowed later | no | no (stop new reads) |

Favorites, email, watchlists, and full private stats remain out of scope for feed payloads.

---

## 6. Consent UX

- Edit Profile / Privacy: “Share watching & ratings with followers” default OFF
- Clear copy that past history is not published
- Disabling sharing stops new events; decide whether existing feed rows are hidden immediately (recommended: hide on read via live flag)

---

## 7. Retention / deletion

- On account delete: cascade feed rows via `actor_id` FK
- On media identity changes: keep trakt keys stable (`trakt-movie-*`, `trakt-episode-*`, `trakt-show-*`)
- Optional retention window (e.g. 180 days) via scheduled cleanup — product decision

---

## 8. Notifications / interactions (future)

Out of scope for first feed ship, but keep hooks open:

- Optional “liked your activity” later
- Do not overload `social_notifications` until feed IDs are stable

---

## 9. Implementation order for next agent

1. Confirm Social V2 migration applied (`profile_follow_requests`, `social_notifications`, discovery).
2. Add `share_activity_with_followers` (default false) + edit-profile toggle.
3. Add `social_activity_events` + emit triggers/RPCs with RLS locked down.
4. Wire Following tab to `list_following_activity`.
5. Add pgTAP: no cross-user leak, sharing default off, bulk exclusion, follower-only reads.
6. Manual emulator: enable sharing, watch one movie, confirm follower sees one card; disable sharing; confirm hide.

---

## 10. Explicit non-goals

- TMDB
- Push notifications for activity
- Surfacing Insights charts to followers
- Client-authored feed inserts
- Reading another user’s `watch_activity_events`
