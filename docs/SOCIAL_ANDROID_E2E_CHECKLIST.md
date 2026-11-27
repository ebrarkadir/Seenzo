# Seenzo Social — Android manual E2E checklist

Use **two signed-in test accounts** (A = primary, B = peer). Feature freeze: no new Social features; verify existing V1–V5 + blocks/reports/moderation/reply-to-reply.

Mark each row Pass / Fail. On Fail, note screen + last service/RPC from the “If fail” column.

---

## P0 — critical

| # | Steps | Expected | If fail |
|---|--------|----------|---------|
| P0-1 | A: Find People / search → open B (public). Follow. | Button → Following or Requested. | `[username]` / `UserSearchResult` → `request_or_follow` |
| P0-2 | B private + discoverable: A requests; B Notifications → Accept. | Request clears; A can open B activity when sharing on. | Notifications accept → `accept_follow_request` |
| P0-3 | B rejects A’s request. | Request gone; A still Requested/cleared correctly on profile. | Notifications reject / profile relationship |
| P0-4 | A follows B; B posts rating+review with sharing on. A Social feed. | Item appears after refresh/focus. | `FriendsActivityFeed` → `list_following_activity_filtered` |
| P0-5 | A followed B **after** B’s old rating. | Old pre-follow activity **not** in A’s feed (follow-since). | Feed RPC follow-since filter |
| P0-6 | A opens review discussion: like, comment, reply on a reply (`@` label), spoiler toggle. | Flat one indent; reply notifies B; double-send blocked. | `discussion` / `create_review_comment` |
| P0-7 | Delete root comment with replies. | Thread gone; count updates after refresh. | `delete_review_comment` cascade |
| P0-8 | A blocks B from profile. | Back; B gone from feed/notifications after Social/Notifications focus. | Block + focus refetch |
| P0-9 | A reports B’s review once; report again. | First OK; second `already_reported`. | `ReportSheet` → `report_social_content` |
| P0-10 | Notification for deleted/hidden review → tap. | Gone alert; no crash. | `resolve_review_discussion_target` |
| P0-11 | Notifications: Follow Back on new follower. | Button becomes Following (disabled); not stuck on Follow Back. | `notifications` / `NotificationRow` |
| P0-12 | Unread badge / mark all read. | Counts clear; list unread styling updates. | `mark_*_social_notifications_read` |

---

## P1 — important

| # | Steps | Expected | If fail |
|---|--------|----------|---------|
| P1-1 | Feed filters (All / Movies / Shows / …). | List resets; no dupes when scrolling pages. | Feed filter + pagination cursor |
| P1-2 | Empty feed / empty notifications / empty search. | Empty copy, no spinner forever. | Empty states on those screens |
| P1-3 | Airplane mode then retry on feed & discussion. | Error copy understandable; retry works. | i18n `social.errors.*` |
| P1-4 | Profile Reviews accordion (own + public B). | Default collapsed; opens list; spoiler/nav OK. | `ProfileReviewsSection` |
| P1-5 | Movie/Show Friends Ratings. | Default collapsed; shows followed ratings only. | `FriendsRatingsSection` |
| P1-6 | B turns off share-with-followers; A refreshes feed. | New B activity stops appearing. | Privacy + feed refetch |
| P1-7 | B private not discoverable; A search. | Not found / not listed. | Discovery search RPC |
| P1-8 | Unblock B; re-follow if needed. | Relationship usable again. | `unblock_user` + profile |
| P1-9 | Rapid tap Follow in search results. | No double request UI glitch. | `UserSearchResult` loading guard |
| P1-10 | Deep link notification → discussion → back to feed. | Feed refreshes; like/comment counts sane. | Focus reload feed |

---

## Accounts matrix (quick)

- **Public follow:** P0-1, P0-4, P0-6  
- **Private request:** P0-2, P0-3, P1-7  
- **Safety:** P0-8, P0-9, P0-10  
- **Freeze regression:** reply-to-reply P0-6; follow-since P0-5  

Do **not** test messaging, reposts, groups, or algorithmic feed (out of freeze scope).
