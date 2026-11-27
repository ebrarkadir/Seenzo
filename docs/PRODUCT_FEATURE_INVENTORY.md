# Seenzo — Product Feature Inventory & Roadmap

**Date:** 2026-11-27  
**Scope:** Movies, TV, Discover, Tracking, Insights (Social = feature freeze; listed only where it overlaps).  
**Method:** Code and data-flow review of `src/app`, `src/components`, `src/services`, `src/tracking`, `src/insights`, Trakt clients, and Supabase migrations. No application code was changed for this document.

**Status rules**

| Status | Meaning |
|--------|---------|
| **IMPLEMENTED** | End-to-end user flow works in the app (UI → state/service → persistence where applicable). |
| **PARTIAL** | Some building blocks or a related flow exist; the stated product idea is not complete. |
| **NOT IMPLEMENTED** | No real user flow for this idea (a nearby button or helper alone is not enough). |

---

## 1. Architecture snapshot (source of truth)

### Tracking

| Layer | Role | Key locations |
|-------|------|----------------|
| Runtime SoT | In-memory tracking state for UI | `src/tracking/TrackingContext.js` (`useTracking`, `commit`) |
| Shape | Shows/movies/intents/ratings/episodes/activity | `src/tracking/watchlist.js` (`normalizeTracking`) |
| Guest persistence | AsyncStorage only | `src/tracking/accountStore.js` (`GUEST_TRACKING_KEY`) |
| Account cache | Local envelope `{ state, server, stamps }` | `accountStore.js` + `TrackingContext` |
| Cloud | Authenticated, non-demo, Trakt-qualified ids | `src/services/supabase/trackingSync.js`, `src/tracking/cloudState.js` |
| Tables | `media_entries`, `episode_entries`, `watch_activity_events` | `supabase/migrations/20261114153000_create_tracking_schema.sql` (+ activity migrations) |

**Synced when signed in & not demo:** show `intent` (`plan` / `watching` / `dropped`), movie saved/watched, ratings (show/movie/episode), episode watched + `watched_at`, activity events.

**Not in tracking sync:** `onboardingComplete`, `demoMode`, guest users, non-Trakt/demo catalog ids, profile shelf favorites (`profile_favorites` via `ProfileContext`), text reviews (`user_media_reviews`).

### Catalog / Trakt

| Used today | Not wired in `src/services/trakt` |
|------------|----------------------------------|
| Search movie/show, trending movie/show | Recommendations / related / similar |
| Show/movie hydrate, seasons, episodes | Collections / franchises |
| People (movie/show/episode) | Trakt calendar / user history OAuth |

Primary modules: `src/services/trakt/catalog.js`, `client.js`, `people.js`, `episodes.js`. Upcoming episodes use **hydrated local air dates** (`upcomingForShows` in `src/tracking/status.js`), not Trakt calendar API.

### Ratings / lists (where they live)

| Concept | Where |
|---------|--------|
| Watchlist (show) | `shows[id].intent === 'plan'` |
| Watchlist (movie) | `movies[id].saved && !watched` |
| Watching / dropped | `shows[id].intent` |
| Ratings | `movies[].rating`, `shows[].rating` / `showRatings`, `episodeRatings` |
| Profile favorites (shelf) | Supabase `profile_favorites` (separate from tracking) |
| Text reviews | `ReviewsContext` + `user_media_reviews` |

### Insights

Screen: `src/app/insights.js` → `buildInsightsDashboard` (`src/insights/calculateInsights.js`). Uses **real tracking + catalog resolve** (watch time, rating distribution, top genres, most-watched shows, monthly activity). Demo mode hides data for signed-in demo users. Activity charts use logged mark-watched events (`activityEvents` / `watch_activity_events`), not proven calendar watch dates (see i18n `insights.activityLoggingNote`).

---

## 2. Idea-list scorecard

### DISCOVER

| Feature | Status | Current behavior | Missing | Key files | Data | Priority | Effort |
|---------|--------|------------------|---------|-----------|------|----------|--------|
| Sizin İçin Önerilenler | **IMPLEMENTED** (V3 hybrid) | Discover category rails + See All; **Hybrid Taste Profile V3**: rating-first Bayesian affinity + pair co-occurrence + specificity (V2 core) plus capped weak signals from unrated progress/watched + plan/watchlist; confidence `ratings` \| `history` \| none; honest history copy; candidate pool = trending/popular + related(top-rated) + genre-popular (non-drama) | AI; friends; OAuth `/recommendations`; deep semantic similarity | `preferenceProfile.js`, `discoverRecommendations.js`, `catalog.js` related/genre pools, Discover UI | Local + Trakt public lists | — | — |
| Bu Akşam Ne İzlesem? | **NOT** | TV/Movie segment + search only | Mood, runtime, duration filters | `discover.js` | — | P2 | Medium |
| Gizli Kalmış Cevherler | **NOT** | No low-popularity / gems feed | Ranking + discovery source | — | Trakt? | P2 | Large |
| İzlediklerine Benzer | **NOT** | No similar/related API or UI | Endpoint + UI | Trakt related **unverified in client** | Trakt | P1 | Medium |
| Watchlist'inden Bir Şey Seç | **PARTIAL** | Bookmark on Discover tiles; Movies “To Watch” list | Smart pick / “tonight from watchlist” UX | `discover.js`, `(tabs)/movies.js`, watchlist helpers | Local | P1 | Small |
| Arkadaşların Sevdi, Sen İzlemedin | **NOT** | Friends ratings on **title detail** only | Discover feed of friends’ liked + unwatched | `FriendsRatingsSection`, `socialV5.getFriendsMediaRatings` | Supabase | P1 | Medium |

### MOVIES

| Feature | Status | Current behavior | Missing | Key files | Data | Priority | Effort |
|---------|--------|------------------|---------|-----------|------|----------|--------|
| Bunu Sevdiysen | **NOT** | Detail: synopsis, friends ratings, cast | Similar movies rail | `movie/[id].js` | Trakt? | P1 | Medium |
| Film Serisi Takibi | **NOT** | No collection metadata/UI | Trakt collections + progress | — | Trakt | P2 | Large |
| Akıllı Watchlist Sıralama | **IMPLEMENTED** (V3 hybrid) | Movies To Watch + TV Plan: **My List \| For You**; My Order (number + drag); My List sorts via compact **Sort dropdown**; For You uses Hybrid Taste Profile V3 (ratings + capped unrated progress/watched + watchlist interest; self-reinforcement excluded per candidate); separate movie/show profiles; genre lines on cards + detail | — | `WatchlistSortSelect.js`, `watchlistSort.js`, `labels.js` genres, `preferenceProfile.js`, migrations `20261127200000` / `2010` / `2100` | Local + Supabase media/order | — | — |
| Oyuncu ve Yönetmen Keşfi | **PARTIAL** | Cast/crew on detail + performance votes | Person pages / filmography browse | `MoviePeopleSections`, `trakt/people.js` | Trakt + Supabase votes | P2 | Large |
| Rewatch Geçmişi | **NOT** | Boolean watched; activity may log rematch | Rewatch count / timeline UI | `activityEvents.js` | Local/Supabase activity | P2 | Medium |

### TV

| Feature | Status | Current behavior | Missing | Key files | Data | Priority | Effort |
|---------|--------|------------------|---------|-----------|------|----------|--------|
| Up Next | **IMPLEMENTED** | Watching cards: next unwatched via `getNextEpisode`; Mark watched; open episode sheet | Dedicated “Up Next” hub optional | `ShowCard.js`, `(tabs)/index.js`, `status.js` | Local | — | — |
| *(related)* Next Episode CTA | **IMPLEMENTED** | Episode popup: after watched, `getReleasedSuccessor` → next popup (no auto-mark) | Not a home Up Next list | `EpisodeDetailSheet.js`, `getReleasedSuccessor` | Local | — | — |
| Yeni Bölüm Radarım | **IMPLEMENTED** | Upcoming from tracked shows’ air dates; TV teaser + `/upcoming` | Trakt calendar sync | `status.upcomingForShows`, `upcoming.js` | Local (+ Trakt hydrate) | — | — |
| Yarım Kalan / Dropped | **IMPLEMENTED** | Dropped section under Watching on TV tab; Dropped badge (not labeled Watching); Resume restores intent | Idle-days “stalled” sort/badge (no trusted idle signal yet) | `(tabs)/index.js`, `ShowCard.js`, `archive/shows.js` | Local | — | — |
| Sezon Tamamlama ve İlerleme | **IMPLEMENTED** | Season progress, mark season / mark all released | — | `show/[id].js`, `progress.js` | Local | — | — |
| Bölüm / Sezon Puan Analizi | **PARTIAL** | Episode/show ratings; Insights by media kind | Season-average analytics | `insights.js`, `personal-ratings.js` | Local | P2 | Medium |
| Diziye Geri Dön / Resume Watching | **PARTIAL** | DROPPED → WATCHING via `setShowIntent` / `applyShowIntent` (preserves episodes & rating; no auto-mark); primary + overflow on show detail; Resume on Dropped cards | Jump UI to **last watched** episode specifically | `show/[id].js`, `watchlist.applyShowIntent`, `lastWatchedEpisode` | Local | P2 | Small |

**Important distinction:** **Up Next** (home Watching: next unwatched + Mark Watched) ≠ **Next Episode** (sheet CTA after mark) ≠ **Resume Watching** (DROPPED → WATCHING intent only). **Stalled-by-days** is still not implemented (`watchedAt` exists in sync meta but is not a trusted idle signal).

### TRACKING

| Feature | Status | Current behavior | Missing | Key files | Data | Priority | Effort |
|---------|--------|------------------|---------|-----------|------|----------|--------|
| Quick Track | **IMPLEMENTED** | Mark next released episode from card | — | `markNextWatched`, `ShowCard` | Local → sync | — | — |
| Toplu Bölüm İşaretleme | **IMPLEMENTED** | Season / show bulk mark | — | `setSeasonWatched`, `setShowWatched` | Local → sync | — | — |
| Geçmiş Tarihli İzleme | **NOT** | `watched_at` defaults to now on sync | User-editable watch date UI | `cloudState.withWatchedAt` | Local/Supabase | P2 | Medium |
| Rewatch Geçmişi | **PARTIAL** | Unwatch→watch can create new activity events | Dedicated rewatch model/UI | `activityEvents.js` | Local/Supabase | P2 | Medium |
| Dropped / Bıraktım | **IMPLEMENTED** | Intent + UI + status badge; TV Dropped section; Resume Watching | — | `show/[id].js`, `(tabs)/index.js`, `status.js` | Local → sync | — | — |
| Cihazlar Arası Senkronizasyon | **IMPLEMENTED** | Account pull/push; guest local-only | Guest multi-device | `TrackingContext`, `trackingSync.js` | Supabase | — | — |

### INSIGHTS

| Feature | Status | Current behavior | Missing | Key files | Data | Priority | Effort |
|---------|--------|------------------|---------|-----------|------|----------|--------|
| Taste DNA | **NOT** | — | Persona / taste profile product | — | Local heuristics | P2 | Large |
| Aylık / Yıllık Wrapped | **NOT** | Monthly activity chart exists as input | Story-style Wrapped product | `ViewingActivitySection` | Local | P2 | Large |
| İzleme Alışkanlıkları | **PARTIAL** | Monthly viewing activity + filters | Habits product framing / patterns | `insights.js`, `calculateActivity.js` | Local | P2 | Medium |
| Puanlama Analizi | **IMPLEMENTED** | Distribution chart + filters | — | `RatingDistributionChart`, `calculateInsights.js` | Local | — | — |
| Keşfetmediğin Türler | **NOT** | **Top genres of watched** (different idea) | Gap analysis vs catalog | `GenreBars`, `calculateGenreCounts` | Local | P2 | Medium |
| İzleme Süresi ve Trendler | **IMPLEMENTED** | Watch-time overview + activity over time | Deeper multi-year Wrapped-style trends optional | `calculateWatchTime`, activity section | Local + Trakt runtime | — | — |

### Counts (idea list only)

| Status | Count |
|--------|-------|
| **IMPLEMENTED** | **12** (incl. Discover Recommended For You V1 + Smart Watchlist) |
| **PARTIAL** | **6** (Resume Watching intent done; jump-to-last-watched still missing) |
| **NOT IMPLEMENTED** | **11** of the original 29 idea rows (idle stalled still missing) |
| **Total original ideas scored** | **29** |

*(TV “Next Episode” CTA and Resume Watching are related to Up Next / Dropped — see TV table. Prefer the TV table over this summary when planning.)*

---

## 3. Features that exist but are **not** on the idea list

Do not re-pitch these as new work without checking:

| Area | Existing capability | Pointers |
|------|---------------------|----------|
| Discover | Trakt search + trending + infinite scroll | `discover.js` |
| Movies | To Watch / Watched segments; detail mark watched; overflow watchlist; RatingSheet + reviews | `movies.js`, `movie/[id].js` |
| TV | Watching / Watchlist segments; UndoBar; episode catch-up continuity; episode overview fetch; Friends Ratings on show | `index.js`, `progress.js`, `EpisodeDetailSheet` |
| Tracking | Sync status / retry; demo library; derived status (caught up / completed); personal ratings screen; archives | `TrackingContext`, `personal-ratings.js`, `archive/*` |
| Insights | Most-watched shows; overview metric cards; activity logging disclaimer | `insights.js`, `MostWatchedShows` |
| People | Cast/crew on movie/show/episode; Best Performance votes | `people.js`, performance vote edge |
| Social (frozen) | Feed, follows, blocks, reports, moderation, reply-to-reply | Out of scope for new Social features |
| Profile | Favorites shelf (≠ watchlist); edit privacy/discovery | `ProfileContext`, `edit-profile.js` |
| Upcoming | Full upcoming screen with filters | `upcoming.js` |

---

## 4. Technical Q&A

**Tracking SoT?** Runtime = `TrackingContext`. Persistence = guest AsyncStorage; account = envelope + Supabase merge.

**Film/episode history sync?** Episode `watched` + `watched_at` and activity events sync. Movies are boolean watched (no movie `watched_at` column in media_entries). Bulk marks may not count toward Insights charts (`isChartEligibleActivity` excludes some bulk sources).

**Recommendation data enough for V1?** **Yes, for a simple local heuristic:** watched sets, ratings, genres (when hydrated), watchlist/plan, exclude already watched; optional friends RPC later. **Weak:** cold start, sparse movie dates, no Trakt related API wired yet.

**Trakt similar/recommended?** **Not used in current client.** Treat as **needs verification** against current Trakt API docs before committing (endpoint names/quotas may differ). Do not assume availability from this inventory alone.

**Overlap:** Friends Ratings ≠ “friends liked you didn’t watch” Discover. Resume Watching (intent) ≠ jump to last watched episode. Top genres ≠ unexplored genres. Next Episode CTA ≠ Up Next home rail.

**Backend-free candidates:** smart watchlist sort; stalled-shows list; jump-to-last-watched; watchlist “pick for me”; local genre-affinity Discover ranking over trending/search results.

**Likely need new tables/RPC/API:** franchise tracking; true rewatch model; backdated UX with reliable movie dates; friends-unwatched Discover at scale; Taste DNA / Wrapped polish may stay client-only if activity data is enough.

---

## 5. Roadmap (three phases)

### PHASE 1 — Finish what you have (data truth + gaps)

1. **Stalled / half-finished shows list** (filter watching by progress age or % ) — P1, Small–Medium, local.  
2. **Jump to last watched episode** (use `lastWatchedEpisode` / open sheet) — P1, Small, local. Intent Resume Watching already ships.  
3. ~~**Smart watchlist sort**~~ — shipped as Movies For You V1 (`preferenceProfile.js`).  
4. **Watchlist “pick one”** on Discover or Movies — P1, Small, local.  
5. Harden Insights/activity honesty (already noted in UI copy); avoid promising calendar truth.

*Goal:* daily TV/Movies feel complete without new backends.

### PHASE 2 — Personalized daily use

1. ~~**Recommendation Engine V1**~~ — shipped on Discover (genre-affinity over trending+popular pools; separate movie/show profiles; no AI).  
2. **Similar on movie/show detail** — after confirming Trakt related/similar endpoints — P1, Medium.  
3. **Friends liked, you didn’t** — compose `get_friends_media_ratings`-style data or new filtered RPC — P1, Medium, Supabase.  
4. Optional: mood/tonight filters on top of V1.

*Goal:* Discover becomes personal without AI API.

### PHASE 3 — Taste DNA / Wrapped / deep discovery

1. Wrapped (year/month story) on existing activity + ratings.  
2. Taste DNA / unexplored genres (gap analysis).  
3. Hidden gems / franchise tracking (likely Trakt collections + product design).  
4. Rewatch history + backdated watches (schema/UX).

*Goal:* retention / shareable insights; higher cost.

### Recommendation Engine V1 feasibility

**Shipped through V3:** rating-first Bayesian affinity + pair co-occurrence + specificity; capped weak signals from unrated TV progress / movie watched / plan-to-watch; candidate pool = trending + popular + related(top-rated) + genre-popular (non-drama); confidence-aware copy; no semantic similarity; no AI; no friends recommendations.

---

## 6. Suggested first build

**Done (2026-11-27):** TV Watching UX correction; Smart Watchlist V2.1; genre labels on Movies/TV cards+detail; Discover **Recommended For You V1** (movie/show rails). **Production must apply watchlist migrations manually** (`watchlist_order_*`, `watchlist_added_at`).

**Done (2026-11-28):** Recommendation Engine **V3 Hybrid Taste Profile** — unrated progress/watched + watchlist interest with caps; self-reinforcement guard; history-confidence cold start (`check-hybrid-preference-v3.cjs`).

**Next suggested:** jump-to-**last**-watched — not idle-days stalled until watch-date semantics are product-trusted.

**Watchlist order sync notes:** Offline dirty orders keep local arrays and push with `p_expected_revision`; `stale_revision` does not silently drop local edits. Until migration is applied, order stays local-only (`order_unavailable`).

---

## 7. Maintenance

Update this file when:

- A PARTIAL idea becomes IMPLEMENTED  
- Trakt related/recommendations are verified and wired  
- Tracking schema gains movie `watched_at` or rewatch counts  

Keep Social changes out unless they unblock Friends→Discover.
