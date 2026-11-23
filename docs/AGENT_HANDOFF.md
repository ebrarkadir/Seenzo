# Seenzo — Agent Handoff

**Purpose:** Transfer confirmed project knowledge to a new Cursor agent session after relocating development to `C:\dev\seenzo`.

**Canonical project path:** `C:\dev\seenzo`  
**Previous path (path-length issues):** `C:\Users\cetin\OneDrive\Desktop\proje\seenzo`

**How to read this document:**
- **Confirmed** = verified from repository source, migrations, AGENTS.md, and prior agent work that was implemented in-repo.
- **User-reported** = stated by the product owner during handoff; treat as current operational fact unless code contradicts it.
- **Intended / unfinished** = product rule that may not fully match current UI wiring yet.
- **Do not invent.** If something is missing here, inspect the code.

**Secrets:** Never copy values from `.env.local`. Required env keys exist as names only: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_TRAKT_CLIENT_ID`.

---

## 1. Project overview

### Product vision and goals
Seenzo is a personal TV/movie tracking mobile app. Users track shows and movies, rate titles/episodes, explore cast and vote on “Best Performance,” manage a premium profile, see personal Insights, and (Social V1) discover/follow public profiles.

### Target platforms
- Android and iOS via **Expo / React Native**
- Cross-platform UI only (no platform-only product UI)
- English UI first, with i18n keys for future languages (`src/i18n/locales/en.json`)

### Technology stack (confirmed)
| Layer | Choice |
| --- | --- |
| App | Expo SDK **58**, React Native **0.88**, React **19.3**, Expo Router |
| Language | **JavaScript / JSX only** in app source (no TS app files) |
| Auth / DB / Storage | Supabase (`@supabase/supabase-js`) |
| Catalog metadata | **Trakt API** (`src/services/trakt/`) |
| Artwork | Trakt-hosted HTTPS image URLs only (`src/services/artwork/`) |
| Local persistence | AsyncStorage + account/guest envelopes |
| Package manager | **npm** (`package-lock.json`; no `bun.lock`) |
| Lint | `npx expo lint` |

Edge Functions under `supabase/functions/` are written in TypeScript (Deno). That is an exception to the app JS-only rule and is intentional for Supabase Functions.

### Current development status (user-reported + code)
- Active development moved to **`C:\dev\seenzo`** because Windows **MAX_PATH (260)** broke Android native builds under the long OneDrive path.
- Git history preserved; dependencies reinstalled successfully (**user-reported**).
- Core tracking, profiles, favorites, votes, Insights code, Social V1 code, and email deep-link code exist in-repo.
- Social V1 + watch activity SQL migrations were **manually applied** to Supabase (**user-reported**).
- Live Social / Insights / email-confirmation emulator verification still outstanding (**user-reported**).
- Android development build must be **retried from the short path** (**user-reported**).

---

## 2. Architecture

### Folder structure (high level)

```
C:\dev\seenzo\
  AGENTS.md                 # Standing agent rules (always follow)
  app.json                  # Expo config; scheme "seenzo"
  package.json
  src\
    app\                    # Expo Router screens ONLY
    auth\                   # AuthContext, callback helpers, messages
    components\             # UI by domain (tracking, profile, social, insights, people, …)
    data\                   # In-memory media library helpers
    i18n\                   # i18next + en.json
    insights\               # Pure insight/activity calculators
    profile\                # ProfileContext
    services\
      artwork\              # Safe Trakt image URL + cache
      supabase\             # Client, sync, profile, social, votes
      trakt\                # Catalog, episodes, people, normalize
    theme\                  # Obsidian Blue tokens
    tracking\               # TrackingContext, watchlist, ratings, activity, cloud sync helpers
  scripts\check-*.cjs       # Focused Node verification scripts
  supabase\
    migrations\             # Versioned SQL
    functions\              # Edge Functions (performance votes)
    tests\database\         # pgTAP-style security tests
  docs\AGENT_HANDOFF.md     # This file
```

**Routing rule:** Routes live in `src/app/`. Non-route code stays outside `src/app/`.

### Expo Router navigation
Root stack: `src/app/_layout.js` (AuthProvider → TrackingProvider → ProfileProvider).

Main tabs (`src/app/(tabs)/_layout.js`):
- TV (`index`)
- Movies
- Discover
- Profile

Important non-tab routes:
- `/onboarding`, `/sign-in`, `/sign-up`, `/auth/callback`
- `/show/[id]`, `/movie/[id]`
- `/insights`, `/personal-ratings`, `/edit-profile`
- `/users/search`, `/user/[username]`
- `/archive/shows`, `/archive/movies`, `/upcoming`, `/trakt-test`

`src/app/index.js` redirects:
- `!onboardingComplete` → `/onboarding`
- else → `/(tabs)`

While onboarding is incomplete, root layout forces `/onboarding` unless the current segment is `onboarding`, `sign-in`, `sign-up`, or `auth` (so email callback is not stolen).

### AuthContext (`src/auth/AuthContext.js`)
- Owns Supabase session (`getSession` + `onAuthStateChange`)
- `signIn` / `signUp` / `signOut` / `resendConfirmation`
- Signup + resend pass `emailRedirectTo: seenzo://auth/callback`
- Never exposes service_role keys; client uses publishable key only

### TrackingContext (`src/tracking/TrackingContext.js`)
- Source of truth for shows/movies/episode watched state, ratings, activity events, onboarding flag, demo mode
- Syncs authenticated non-demo state to Supabase via `trackingSync.js` / `cloudState.js`
- Guest data is device-local and isolated from account libraries
- Demo mode loads sample data and must not push cloud sync as real account data

### ProfileContext (`src/profile/ProfileContext.js`)
- Loads/saves own profile + favorites
- Avatar/banner upload via private Storage + signed URLs
- Scoped by auth `userId` (account switch isolation)

### Services and state management
- Prefer simple React context + AsyncStorage over heavy global stores
- Trakt responses normalized to provider-qualified IDs: `trakt-show-…`, `trakt-movie-…`, `trakt-episode-…`
- Catalog metadata is **not** stored as the system of record in Supabase; tracking rows store IDs + user state

### Supabase integration
- Client: `src/services/supabase/client.js` — AsyncStorage session, `detectSessionInUrl: false`, **`flowType: 'pkce'`**
- Config guard: `config.js` rejects missing/placeholder/http/secret keys
- Tracking sync, profile CRUD, social discovery, vote clients live under `src/services/supabase/`

### Trakt API integration
- `src/services/trakt/catalog.js`, `episodes.js`, `people.js`, `normalize.js`, `config.js`
- Used for search, show/movie detail, episode lists, cast/crew
- Attribution string shown on Profile

### Guest / demo architecture (confirmed)
- **Guest:** local only; logout opens empty guest (does not restore prior guest lists)
- **Demo:** `demoMode: true`; Insights/profile stats hide demo pollution for signed-in demo; sync push suppressed for demo
- **Account:** cloud sync + local envelope cache; accounts stay isolated by `userId`

---

## 3. Implemented features

### Movie and TV tracking
Users add shows/movies, set show intent (`plan` / `watching` / `dropped`), mark movies watched/saved. Caught up / completed for shows are **derived** from released episode progress, not stored as intents.

### Watchlists and watched status
Movies: `movie_saved` / `movie_watched`. Shows: intent + per-episode watched flags in `episode_entries` / local state. UI across Home, Movies tab, detail sheets, archives.

### Seasons and episodes
Show detail supports season browsing, per-episode watched toggles, bulk season/show marks (with undo). Bulk sources are tagged in activity logging (`season_bulk` / `show_bulk`) and excluded from ordinary monthly Insights charts.

### Ratings and personal rating history
1–10 ratings on movies, shows, episodes. `personal-ratings` screen + `RatingSheet`. Cloud fields on media/episode rows.

### Best Performance actor voting
- Episode votes: `performance_votes` + Edge Function `performance-vote`
- Movie votes: `movie_performance_votes` + Edge Function `movie-performance-vote`
- Clients do **not** write vote tables directly; Edge Function validates auth, watched eligibility, and Trakt cast credits
- UI: cast-only candidates; ordering uses **vote count DESC**, then **billing/cast order ASC** as tiebreak (restored after an earlier sort-only bug)
- “See All” cast list exists for longer casts

### Actor and cast information
Trakt people endpoints; episode guest stars; movie cast/crew sections; avatars via artwork pipeline.

### User profiles and media uploads
Premium private profile: display name, username, bio, avatar, banner. Uploads go to private bucket `profile-media` under `{userId}/avatar|banner/…`, displayed with short-lived signed URLs. Email is account metadata (shown read-only on edit), not a public profile field.

### Favorite movies and TV shows
Exactly **4** favorites per type (`profile_favorites` + `set_profile_favorites` RPC). Editable shelves on own Profile; read-only on public profiles.

### Insights V1 and V2
- V1: aggregate metrics (watch time, averages, genres, most watched, rating distribution)
- V2: Viewing Activity monthly charts from `watch_activity_events`
- Chart time uses **`server_recorded_at`** (DB-authoritative), not client-claimed watch calendar dates
- No historical backfill of old watched rows into activity
- Empty activity is expected until events exist / migration was deployed (earlier empty-state confusion came from undeployed table / no backfill)

### Social V1
- Profile visibility `is_public` (default **private**)
- Username search with debounce + pagination (`/users/search`)
- Public profile (`/user/[username]`): banner/avatar (if authorized), name, username, bio, favorites, aggregate stats, follow counts, Follow/Unfollow
- Does **not** expose email, private watchlists, personal ratings detail, or full tracking history
- Entry point: compact **Find People** row under My Activity on Profile (`FindPeopleRow`)

### User search and following
- Search only `is_public = true` profiles; never emails
- `profile_follows` with no self-follow, public-target insert RLS, own-delete
- Follow SELECT limited to **own outgoing edges** (Social V1 needs counts via RPC + own follow state, not foreign follower ID graphs)
- Counts/stats via security definer RPCs gated on public (or owner for own private stats where coded)

### Authentication and onboarding
- Email/password Supabase Auth
- Confirmation redirect: **`seenzo://auth/callback`**
- Callback handles PKCE `code`, implicit tokens, and `token_hash` / `verifyOtp`; processes each URL once; no token logging
- Resend confirmation on signup confirm screen and on sign-in when email is unconfirmed
- Onboarding: welcome → pick shows (optional progress) → pick movies → complete
- `onboardingComplete` persists per account/guest; completed accounts should skip welcome

**Intended auth gateway UX (product rule from owner):**
- Signed out first launch: **Sign In / Create Account / Try Demo**
- New verified users: Welcome → Get Started → main app (until onboarding completes)
- Existing completed accounts: enter main app directly

**Current code note:** Welcome onboarding still presents **Get Started** + **Try Demo**; Sign In / Create Account appear prominently on guest Profile. Aligning the absolute first-launch gateway with the intended three actions may still need UX polish—verify before claiming it is done.

---

## 4. Supabase

### Relevant tables (confirmed in migrations)
| Table | Role |
| --- | --- |
| `profiles` | Identity + social visibility (`username`, `bio`, media paths, `is_public`) |
| `media_entries` | Per-user show/movie tracking + ratings |
| `episode_entries` | Per-user episode watched/rating |
| `performance_votes` | Episode Best Performance votes (service_role DML) |
| `movie_performance_votes` | Movie Best Performance votes (service_role DML) |
| `profile_favorites` | Up to 4 favorites per media type |
| `watch_activity_events` | Append-only Insights activity log |
| `profile_follows` | Follow graph |

Auth users live in `auth.users` (not app-owned).

### RLS security design (summary)
- Tracking tables: **own-row only** for authenticated
- Vote tables: **no** authenticated DML policies; Edge Function + `service_role`
- Favorites: own CRUD; public SELECT only when owner profile is public
- Profiles: own CRUD; additional public SELECT when `is_public` and username set
- Follows: insert own→public only; delete own; SELECT own outgoing only
- Activity: select/insert own; no authenticated update/delete

### Storage policies
- Bucket `profile-media` is **private**
- Own-object CRUD under `{auth.uid()}/…`
- Additional authenticated SELECT for objects owned by **public** profiles (signed URL delivery—not a public bucket)

### Edge Functions
- `supabase/functions/performance-vote`
- `supabase/functions/movie-performance-vote`  
Validate JWT, watched eligibility, Trakt cast membership, then write votes as service role.

### RPC functions (non-exhaustive)
- `set_profile_favorites`
- `performance_vote_stats` / `movie_performance_vote_stats`
- `get_public_profile_stats`
- `get_public_follow_counts`
- `seenzo_handle_new_user` (creates profile row on signup)
- `set_updated_at` / activity force-server-time trigger function

### Migrations (in repo)
1. `20261114153000_create_tracking_schema.sql`
2. `20261114180000_create_performance_votes.sql`
3. `20261115220000_create_movie_performance_votes.sql`
4. `20261116170000_profile_favorites_and_media.sql`
5. `20261116210000_create_watch_activity_events.sql` — column-level INSERT (no client `server_recorded_at`/`created_at`/`id`) + BEFORE INSERT force `now()`
6. `20261123180000_social_profiles_and_follows.sql` — visibility, follows, public read policies, RPCs

**User-reported:** Social V1 + watch activity migrations were manually applied successfully. Older migrations were applied in earlier phases (tracking/votes/favorites)—treat as deployed unless advisors say otherwise; do not re-run destructive creates blindly.

### Security decisions worth preserving
- No `service_role` in mobile clients
- Publishable key only; config rejects secret keys
- Private profiles undiscoverable
- Public media via signed URLs + RLS, not public bucket
- Activity timestamps cannot be forged by authenticated clients
- Vote integrity enforced server-side
- Prefer correcting undeployed migration files in place; if already deployed, ship additive corrective migrations instead of drop/recreate

---

## 5. Important technical decisions (why)

| Decision | Why |
| --- | --- |
| JS/JSX only in app | Project rule; keep Expo RN simple; avoid TS migration cost |
| Obsidian Blue theme | Distinct dark UI (`#0C1015` / `#79C4FF`); consistent premium feel |
| Trakt as metadata provider | Catalog + IDs + people; free-friendly; attribution required |
| No unauthorized TMDB commercial usage | Artwork restricted to `*.trakt.tv` HTTPS hosts |
| Auth vs demo/guest isolation | Prevent demo/guest data leaking into account cloud state |
| Avoid overengineering | Focused contexts, versioned SQL, small check scripts |
| Preserve working features | Every scoped task must not regress tracking/votes/profile/insights |
| Expo docs over training memory | SDK 58 breaks remembered APIs; fetch versioned docs |
| PKCE + native scheme for email confirm | Mobile deep link without hosting a website |
| CNG for native projects | Configure via `app.json`; avoid hand-editing `android/`/`ios/` when possible |

---

## 6. Testing

### Check scripts (`scripts/check-*.cjs`)
These are **offline Node assertions** over source/migrations (not full emulator E2E).

| Script | Purpose |
| --- | --- |
| `check-auth.cjs` | Config guards, email/password validation, sign-out behavior |
| `check-auth-deeplink.cjs` | Scheme, redirect URL, PKCE client flags, callback route, resend wiring |
| `check-schema.cjs` | Tracking schema expectations |
| `check-tracking.cjs` | Local tracking helpers |
| `check-sync.cjs` | Sync/queue behavior |
| `check-activity.cjs` / `check-activity-schema.cjs` | Activity event rules + migration hardening |
| `check-insights.cjs` | Insight calculators |
| `check-profile.cjs` / `check-profile-media.cjs` | Profile/favorites/media |
| `check-social.cjs` | Social rules, migration policies, Find People entry |
| `check-personal-ratings.cjs` / `check-rating-sheet.cjs` | Ratings UI/helpers |
| `check-people.cjs` / `check-episode-cast.cjs` / `check-performance-*.cjs` / `check-movie-votes.cjs` | Cast + votes |
| `check-show-detail.cjs` / `check-movie-detail.cjs` / `check-episode-overviews.cjs` / `check-trakt.cjs` | Detail/catalog |
| `check-reliability.cjs` | Broader reliability assertions |

Also: `npx expo lint` before declaring tasks done.

### Database tests
`supabase/tests/database/*.test.sql` (RLS/security scenarios). Run only against a suitable DB with pgTAP; not automatically executed in CI from this handoff’s knowledge.

### What was actually tested in prior agent work (confirmed run outputs)
- Multiple `check-*.cjs` suites for features being built (auth, social, activity schema, profile, insights, votes, etc.)
- `expo lint` after those features
- **Not** claimed as passed: full live Social E2E, full Insights V2 E2E on device, live email→app confirmation on emulator

### Still requires emulator / device testing
- Android development build from `C:\dev\seenzo`
- Email verification deep link cold start + warm start
- Social search / public profile / follow after deployed migrations
- Insights Viewing Activity with real watched events
- Auth gateway / onboarding resume paths for new vs completed accounts

---

## 7. Known bugs and unfinished work

### Environment / build (user-reported)
- Moved to `C:\dev\seenzo` to avoid Windows 260-character path limit during Android native build
- Git repository and history preserved
- Dependencies reinstalled successfully
- Retry Android development build from the short path
- `npm audit` reported **8 moderate** vulnerabilities — investigate safely; **do not** auto-force upgrades without review

### Native project note
An `android/` directory may exist from prior `expo run:android` attempts. Prefer Expo CNG discipline from AGENTS.md: don’t hand-edit native trees; configure via `app.json` / plugins. Rebuild from `C:\dev\seenzo`.

### Social / Insights
- Social V1 code + migrations applied; **live functional testing still needed**
- Insights V2 code + activity migration applied; **live functional testing still needed**

### Email verification
- Implemented with `seenzo://auth/callback` + PKCE-aware callback screen
- Supabase Dashboard Redirect URL must include `seenzo://auth/callback` (manual; agents must not change remote settings without approval)
- **Not yet verified end-to-end** in Android emulator
- Custom schemes require a **development/standalone build**, not Expo Go

### Auth / onboarding product gaps
- Intended signed-out gateway: Sign In / Create Account / Try Demo
- Welcome / Get Started only for new users after verification until onboarding completes
- Existing completed accounts enter main app directly
- Confirm these flows on device after rebuild; adjust UI only if code does not match the intended rules

### Earlier issues already addressed in code (context, not open bugs)
- Insights empty activity + Most Watched specials counting (regular-episode progress)
- Best Performance vote sort + cast billing tiebreak
- Social Find People buried in Account Settings → moved to compact row under My Activity
- Follow SELECT was tightened to avoid exposing unrelated follower user IDs
- Activity `server_recorded_at` forgeability hardened via grants + trigger

---

## 8. Next development steps (prioritized)

1. **Rebuild Android from `C:\dev\seenzo`**  
   `npx expo run:android` (or EAS development profile if adopted). Confirm `seenzo://` scheme registration.

2. **Finish email confirmation E2E**  
   Ensure Redirect URL allowlist; sign up; open mail on device; callback establishes session; new user hits onboarding once.

3. **Verify auth gateway / onboarding rules on device**  
   Align UI with Sign In / Create Account / Try Demo if first-launch still mismatches.

4. **Live-test Social V1**  
   Public/private discovery, public profile fields only, follow/unfollow, Find People navigation.

5. **Live-test Insights V2**  
   Individual watches create chart points; bulk marks excluded; no forged timestamps.

6. **Safely review `npm audit`**  
   Identify advisories; fix only with compatible Expo SDK versions (`npx expo install` where applicable).

7. **Only then** continue product features (deeper social, polish, release prep).

Do not deploy SQL, commit, or push unless the user explicitly asks.

---

## 9. Agent operating rules

Standing rules live in `AGENTS.md`. Practical collaboration norms from this project:

1. **Investigate before editing** — read existing patterns, migrations, and Expo/Supabase docs for the installed versions.
2. **Preserve architecture** — Expo Router layout, contexts, Trakt IDs, Obsidian Blue, i18n keys.
3. **Make focused changes** — no unrelated refactors or features.
4. **Run relevant checks** — matching `scripts/check-*.cjs` + `npx expo lint`.
5. **Report changed files** and unresolved issues briefly at the end.
6. **Never claim tests that were not actually run.**
7. **Never automatically commit or push.**
8. **Never deploy** (SQL, Edge Functions, store builds) without explicit approval.
9. **Do not expose credentials or secrets**; never paste `.env.local` values into docs or chat.
10. Ask approval only for paid resources, destructive data ops, production/security changes, major architecture conflicts, or irreversible publish actions.
11. Prefer free libraries; keep Android/iOS parity; JS/JSX only in app source.
12. Stop when the requested task is complete—don’t expand scope.

---

## Quick reference — auth deep link

| Item | Value |
| --- | --- |
| Scheme | `seenzo` (`app.json`) |
| Callback | `seenzo://auth/callback` |
| Client flow | PKCE (`flowType: 'pkce'`) |
| Route | `src/app/auth/callback.js` |
| Dashboard | Authentication → URL Configuration → Redirect URLs → add `seenzo://auth/callback` |

---

## Uncertainty log

- Exact live Supabase project ref / which older migrations are present on the remote should be confirmed with the Dashboard or CLI if a task depends on it; this handoff trusts owner report that social + activity migrations are applied.
- Whether OneDrive and `C:\dev\seenzo` remain two working trees or one migrated tree: **operate on `C:\dev\seenzo`** going forward.
- First-launch auth gateway may still need a small UX pass to match the intended three-button signed-out experience exactly—verify in the running app before changing.

---

*Generated as a knowledge-transfer artifact only. No application code was modified for feature work in this task beyond creating this document.*
