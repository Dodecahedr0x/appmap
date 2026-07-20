# Gamification: XP & Levels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** add a cosmetic XP/Levels system to nebulous.world — users earn XP for submitting apps, suggesting tags, voting, and staking (plus a once-per-day bonus), see their level/title on a new `/profile` page and a navbar badge.

**Architecture:** all new state lives in the indexer's Postgres schema (a new migration + a new `handlers/xp.rs` module) since the indexer is the sole DB owner and query layer. XP is granted from the existing write paths that already create `Vote`/`Stake` rows (`handlers/votes.rs`/`stakes.rs`, HTTP-triggered) and `App`/`AppTag` rows (`processors/product.rs`, crawler-triggered from confirmed on-chain instructions). The Next.js app adds two thin proxy routes, a hook, a profile page/component, and a navbar badge — no new app-owned database access (there is none in this repo).

**Tech Stack:** Rust/axum/sqlx (indexer), Next.js/TypeScript/Tailwind (app), Postgres.

**Reference:** `docs/plans/2026-07-20-gamification-xp-levels-design.md` (the approved design — note: this plan corrects a small arithmetic slip in that doc's Section 3 table for levels 10/20; the formula `50 * (level-1) * level` is what's actually implemented, consistent with the doc's own levels 1–5 and titles).

---

### Task 1: Migration — `XpEvent` table + `User` columns

**Files:**
- Create: `indexer/migrations/006_xp_levels.sql`

**Step 1: Write the migration**

```sql
-- XP & Levels: cosmetic gamification layered on existing actions. See
-- docs/plans/2026-07-20-gamification-xp-levels-design.md. Level/title are
-- pure functions of `xp` (indexer/src/handlers/xp.rs), not stored here.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastXpDate" DATE;

CREATE TABLE IF NOT EXISTS "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per (user, kind, target): this is what makes vote/stake XP
-- "first time per target only" (design doc Section 2), and it makes
-- reprocessing (backfill re-run, startup) idempotent for submit_app/
-- suggest_tag too. daily_bonus rows have targetId = NULL, and Postgres
-- never treats two NULLs as equal in a unique index, so multiple
-- daily_bonus rows per user (one per day) are unaffected by this index.
CREATE UNIQUE INDEX IF NOT EXISTS "XpEvent_userId_kind_targetId_key"
    ON "XpEvent" ("userId", "kind", "targetId");

CREATE INDEX IF NOT EXISTS "XpEvent_userId_idx" ON "XpEvent" ("userId");
```

**Step 2: Verify it applies cleanly**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -20`
Expected: builds successfully (sqlx's compile-time query cache isn't used here — `sqlx::query`/`query_as` are runtime-checked in this codebase, per the existing files read — so this step just confirms no Rust changes broke yet; the migration itself only gets validated against a real Postgres in Task 8's manual verification).

**Step 3: Commit**

```bash
git add indexer/migrations/006_xp_levels.sql
git commit -m "feat(indexer): add XpEvent table and User.xp/lastXpDate columns"
```

---

### Task 2: Level curve — pure functions + unit tests

**Files:**
- Create: `indexer/src/handlers/xp.rs`
- Modify: `indexer/src/handlers/mod.rs`

**Step 1: Add the module declaration**

In `indexer/src/handlers/mod.rs`, add (after `pub mod x402;`, keeping the file's alphabetical convention):

```rust
pub mod xp;
```

**Step 2: Write the failing test**

Create `indexer/src/handlers/xp.rs` with just the test module first:

```rust
//! XP & Levels — cosmetic gamification layered on existing on-chain actions
//! (submit app, suggest tag, vote, stake) plus a once-per-UTC-day bonus. See
//! docs/plans/2026-07-20-gamification-xp-levels-design.md. Never touches
//! vote weight, fees, or ranking — status only.

#[cfg(test)]
mod curve_tests {
    use super::*;

    #[test]
    fn level_1_starts_at_zero() {
        assert_eq!(cumulative_xp_for_level(1), 0);
        assert_eq!(level_for_xp(0), 1);
    }

    #[test]
    fn matches_design_doc_table() {
        assert_eq!(cumulative_xp_for_level(2), 100);
        assert_eq!(cumulative_xp_for_level(3), 300);
        assert_eq!(cumulative_xp_for_level(4), 600);
        assert_eq!(cumulative_xp_for_level(5), 1000);
    }

    #[test]
    fn level_for_xp_is_the_floor_of_the_curve() {
        assert_eq!(level_for_xp(99), 1);
        assert_eq!(level_for_xp(100), 2);
        assert_eq!(level_for_xp(299), 2);
        assert_eq!(level_for_xp(300), 3);
    }

    #[test]
    fn titles_match_level_ranges() {
        assert_eq!(title_for_level(1), "Newcomer");
        assert_eq!(title_for_level(4), "Newcomer");
        assert_eq!(title_for_level(5), "Regular");
        assert_eq!(title_for_level(10), "Contributor");
        assert_eq!(title_for_level(20), "Curator");
        assert_eq!(title_for_level(30), "Tastemaker");
        assert_eq!(title_for_level(50), "Signal");
        assert_eq!(title_for_level(1000), "Signal");
    }
}
```

**Step 3: Run to verify it fails**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo test --lib handlers::xp 2>&1 | tail -30`
Expected: FAIL — `cannot find function cumulative_xp_for_level in this scope` (doesn't exist yet).

**Step 4: Implement the curve functions**

Add above the test module in the same file:

```rust
pub const XP_SUBMIT_APP: i32 = 100;
pub const XP_SUGGEST_TAG: i32 = 40;
pub const XP_VOTE: i32 = 20;
pub const XP_STAKE: i32 = 30;
pub const XP_DAILY_BONUS: i32 = 15;

/// Cumulative XP required to REACH `level` (level 1 = 0 XP). Triangular
/// growth — each additional level costs a constant amount more than the
/// last (100, 200, 300, ...), so early levels come fast and later ones
/// stretch out. See design doc Section 3.
pub fn cumulative_xp_for_level(level: i32) -> i32 {
    50 * (level - 1) * level
}

pub fn level_for_xp(xp: i32) -> i32 {
    let mut level = 1;
    while cumulative_xp_for_level(level + 1) <= xp {
        level += 1;
    }
    level
}

pub fn title_for_level(level: i32) -> &'static str {
    match level {
        1..=4 => "Newcomer",
        5..=9 => "Regular",
        10..=19 => "Contributor",
        20..=29 => "Curator",
        30..=49 => "Tastemaker",
        _ => "Signal",
    }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo test --lib handlers::xp 2>&1 | tail -30`
Expected: PASS — 4 tests passed.

**Step 6: Commit**

```bash
git add indexer/src/handlers/xp.rs indexer/src/handlers/mod.rs
git commit -m "feat(indexer): add XP level curve and title functions"
```

---

### Task 3: XP granting — `record_event`, `award`, `backfill`

**Files:**
- Modify: `indexer/src/handlers/xp.rs`

**Step 1: Add the granting functions**

Append to `indexer/src/handlers/xp.rs` (before the test module):

```rust
use sqlx::PgPool;

async fn record_event(
    pool: &PgPool,
    user_id: &str,
    kind: &str,
    target_id: Option<&str>,
    amount: i32,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        INSERT INTO "XpEvent" (id, "userId", kind, "targetId", amount, "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())
        ON CONFLICT ("userId", kind, "targetId") DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(kind)
    .bind(target_id)
    .bind(amount)
    .execute(pool)
    .await?;

    let inserted = result.rows_affected() > 0;
    if inserted {
        sqlx::query(r#"UPDATE "User" SET xp = xp + $2 WHERE id = $1"#)
            .bind(user_id)
            .bind(amount)
            .execute(pool)
            .await?;
    }
    Ok(inserted)
}

/// Awards XP for a fresh (wallet, target) action, plus the once-per-UTC-day
/// bonus if this wallet hasn't earned XP yet today. Best-effort by design —
/// callers log and swallow errors rather than failing the underlying vote/
/// stake/submit action over a gamification hiccup (cosmetic only, must never
/// block or roll back a real on-chain-backed write).
pub async fn award(
    pool: &PgPool,
    user_id: &str,
    kind: &str,
    target_id: Option<&str>,
    amount: i32,
) -> Result<(), sqlx::Error> {
    if !record_event(pool, user_id, kind, target_id, amount).await? {
        return Ok(());
    }

    let today = chrono::Utc::now().naive_utc().date();
    let last_xp_date: Option<chrono::NaiveDate> =
        sqlx::query_scalar(r#"SELECT "lastXpDate" FROM "User" WHERE id = $1"#)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    if last_xp_date != Some(today) {
        record_event(pool, user_id, "daily_bonus", None, XP_DAILY_BONUS).await?;
        sqlx::query(r#"UPDATE "User" SET "lastXpDate" = $2 WHERE id = $1"#)
            .bind(user_id)
            .bind(today)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// One-off historical backfill so existing users don't start at 0 XP when
/// this ships. Safe to call on every startup — `record_event`'s
/// `ON CONFLICT DO NOTHING` makes every call after the first a no-op.
/// Deliberately does NOT grant daily bonuses for backfilled rows (there's no
/// meaningful "day" for a historical action being processed today).
pub async fn backfill(pool: &PgPool) -> Result<usize, sqlx::Error> {
    let mut granted = 0;

    let votes: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "userId", "appId" FROM "Vote""#)
            .fetch_all(pool)
            .await?;
    for (user_id, app_id) in votes {
        if record_event(pool, &user_id, "vote", Some(&app_id), XP_VOTE).await? {
            granted += 1;
        }
    }

    let stakes: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "userId", "appTagId" FROM "Stake""#)
            .fetch_all(pool)
            .await?;
    for (user_id, app_tag_id) in stakes {
        if record_event(pool, &user_id, "stake", Some(&app_tag_id), XP_STAKE).await? {
            granted += 1;
        }
    }

    let apps: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "submittedBy", id FROM "App" WHERE "submittedBy" IS NOT NULL"#,
    )
    .fetch_all(pool)
    .await?;
    for (user_id, app_id) in apps {
        if record_event(pool, &user_id, "submit_app", Some(&app_id), XP_SUBMIT_APP).await? {
            granted += 1;
        }
    }

    let tags: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "suggestedBy", id FROM "AppTag" WHERE "suggestedBy" IS NOT NULL"#,
    )
    .fetch_all(pool)
    .await?;
    for (user_id, app_tag_id) in tags {
        if record_event(pool, &user_id, "suggest_tag", Some(&app_tag_id), XP_SUGGEST_TAG).await? {
            granted += 1;
        }
    }

    if granted > 0 {
        log::info!("xp backfill: granted {granted} historical XpEvents");
    }
    Ok(granted)
}
```

**Step 2: Build to verify it compiles**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully (no test here — these functions need a live Postgres; they're exercised end-to-end in Task 8's manual verification).

**Step 3: Commit**

```bash
git add indexer/src/handlers/xp.rs
git commit -m "feat(indexer): add XP granting and historical backfill functions"
```

---

### Task 4: HTTP endpoints — `GET /xp/:id` and `GET /xp/:id/activity`

**Files:**
- Modify: `indexer/src/handlers/xp.rs`
- Modify: `indexer/src/api.rs`

**Step 1: Add the DTOs and handlers**

Append to `indexer/src/handlers/xp.rs` (after `backfill`, before the test module — add the needed imports at the top of the file alongside `use sqlx::PgPool;`):

```rust
use crate::api::{ApiError, ApiState};
use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDateTime;
use serde::Serialize;
use std::sync::Arc;
```

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct XpDto {
    user_id: String,
    xp: i32,
    level: i32,
    title: &'static str,
    xp_into_level: i32,
    xp_for_next_level: i32,
    progress: f64,
    apps_submitted: i64,
    tags_suggested: i64,
    votes_cast: i64,
    stakes_made: i64,
}

async fn get_xp(
    State(state): State<Arc<ApiState>>,
    Path(user_id): Path<String>,
) -> Result<Json<XpDto>, ApiError> {
    let xp: i32 = sqlx::query_scalar(r#"SELECT xp FROM "User" WHERE id = $1"#)
        .bind(&user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(crate::api::internal)?
        .ok_or_else(|| crate::api::not_found("User not found"))?;

    let level = level_for_xp(xp);
    let title = title_for_level(level);
    let level_floor = cumulative_xp_for_level(level);
    let level_ceiling = cumulative_xp_for_level(level + 1);

    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
          COUNT(*) FILTER (WHERE kind = 'submit_app'),
          COUNT(*) FILTER (WHERE kind = 'suggest_tag'),
          COUNT(*) FILTER (WHERE kind = 'vote'),
          COUNT(*) FILTER (WHERE kind = 'stake')
        FROM "XpEvent" WHERE "userId" = $1
        "#,
    )
    .bind(&user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(XpDto {
        user_id,
        xp,
        level,
        title,
        xp_into_level: xp - level_floor,
        xp_for_next_level: level_ceiling - level_floor,
        progress: (xp - level_floor) as f64 / (level_ceiling - level_floor) as f64,
        apps_submitted: counts.0,
        tags_suggested: counts.1,
        votes_cast: counts.2,
        stakes_made: counts.3,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct XpActivityEntry {
    id: String,
    kind: String,
    app_name: Option<String>,
    app_slug: Option<String>,
    tag_name: Option<String>,
    amount: i32,
    created_at: String,
}

async fn get_activity(
    State(state): State<Arc<ApiState>>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let rows: Vec<(String, String, i32, NaiveDateTime, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT
          e.id, e.kind, e.amount, e."createdAt",
          COALESCE(a.name, a2.name) AS app_name,
          COALESCE(a.slug, a2.slug) AS app_slug,
          t.name AS tag_name
        FROM "XpEvent" e
        LEFT JOIN "App" a ON e.kind IN ('vote', 'submit_app') AND a.id = e."targetId"
        LEFT JOIN "AppTag" at ON e.kind IN ('stake', 'suggest_tag') AND at.id = e."targetId"
        LEFT JOIN "App" a2 ON at."appId" = a2.id
        LEFT JOIN "Tag" t ON at."tagId" = t.id
        WHERE e."userId" = $1
        ORDER BY e."createdAt" DESC
        LIMIT 50
        "#,
    )
    .bind(&user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let events: Vec<XpActivityEntry> = rows
        .into_iter()
        .map(|(id, kind, amount, created_at, app_name, app_slug, tag_name)| XpActivityEntry {
            id,
            kind,
            app_name,
            app_slug,
            tag_name,
            amount,
            created_at: crate::handlers::engine::to_rfc3339(created_at),
        })
        .collect();

    Ok(Json(serde_json::json!({ "events": events })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/xp/:user_id", get(get_xp))
        .route("/xp/:user_id/activity", get(get_activity))
}
```

**Step 2: Wire the router**

In `indexer/src/api.rs`, in the `router()` function's merge chain, add (after `.merge(crate::handlers::x402::routes())`):

```rust
.merge(crate::handlers::xp::routes())
```

**Step 3: Build to verify it compiles**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully.

**Step 4: Commit**

```bash
git add indexer/src/handlers/xp.rs indexer/src/api.rs
git commit -m "feat(indexer): expose GET /xp/:id and /xp/:id/activity endpoints"
```

---

### Task 5: Hook XP into voting

**Files:**
- Modify: `indexer/src/handlers/votes.rs`

**Step 1: Add the award call**

In `votes.rs`'s `create` function, right after the `refresh_app(&state.pool, &req.app_id).await?;` line and before the final `let updated: ... = sqlx::query_as(...)` block, add:

```rust
    if let Err(e) = crate::handlers::xp::award(
        &state.pool,
        &req.user_id,
        "vote",
        Some(&req.app_id),
        crate::handlers::xp::XP_VOTE,
    )
    .await
    {
        log::warn!("failed to award vote XP for user {}: {e}", req.user_id);
    }
```

**Step 2: Build to verify it compiles**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully.

**Step 3: Commit**

```bash
git add indexer/src/handlers/votes.rs
git commit -m "feat(indexer): award XP on first vote per (user, app)"
```

---

### Task 6: Hook XP into staking

**Files:**
- Modify: `indexer/src/handlers/stakes.rs`

**Step 1: Add the award call**

In `stakes.rs`'s `create` function, right after `refresh_app(&state.pool, &app_id).await?;` and before the final `Ok(Json(serde_json::json!(...)))`, add:

```rust
    if let Err(e) = crate::handlers::xp::award(
        &state.pool,
        &req.user_id,
        "stake",
        Some(&req.app_tag_id),
        crate::handlers::xp::XP_STAKE,
    )
    .await
    {
        log::warn!("failed to award stake XP for user {}: {e}", req.user_id);
    }
```

**Step 2: Build to verify it compiles**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully.

**Step 3: Commit**

```bash
git add indexer/src/handlers/stakes.rs
git commit -m "feat(indexer): award XP on first stake per (user, app tag)"
```

---

### Task 7: Hook XP into app submission and tag suggestion

**Files:**
- Modify: `indexer/src/processors/product.rs`

**Step 1: Add the award call to `sync_app_from_init`**

Right after the `log::info!("synced App {} (slug {slug}) from init_app", decoded.app_id);` line, before `Ok(())`, add:

```rust
    if let Err(e) = crate::handlers::xp::award(
        pool,
        &submitted_by,
        "submit_app",
        Some(&decoded.app_id),
        crate::handlers::xp::XP_SUBMIT_APP,
    )
    .await
    {
        log::warn!("failed to award submit_app XP for user {submitted_by}: {e}");
    }
```

**Step 2: Add the award call to `sync_tag_from_suggest`**

Right after the `log::info!("synced Tag {} + AppTag {app_tag_id} from suggest_tag", decoded.tag_id);` line, before `Ok(())`, add:

```rust
    if let Err(e) = crate::handlers::xp::award(
        pool,
        &suggested_by,
        "suggest_tag",
        Some(&app_tag_id),
        crate::handlers::xp::XP_SUGGEST_TAG,
    )
    .await
    {
        log::warn!("failed to award suggest_tag XP for user {suggested_by}: {e}");
    }
```

**Step 3: Build to verify it compiles**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully.

**Step 4: Commit**

```bash
git add indexer/src/processors/product.rs
git commit -m "feat(indexer): award XP on app submission and tag suggestion"
```

---

### Task 8: Wire backfill into startup + full indexer verification

**Files:**
- Modify: `indexer/src/main.rs`

**Step 1: Call backfill at startup**

In `main.rs`, right after the `reconcile::run(&pool, &backfill_result.decoded, config.vote_token_decimals).await?;` line, add:

```rust
    if let Err(e) = handlers::xp::backfill(&pool).await {
        log::warn!("xp backfill failed: {e}");
    }
```

**Step 2: Build the whole indexer**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo build 2>&1 | tail -30`
Expected: builds successfully.

**Step 3: Run the unit tests**

Run: `cd indexer && CARGO_TARGET_DIR=/Users/dode/Documents/solana/appmap/indexer/target cargo test --lib 2>&1 | tail -40`
Expected: PASS, including the 4 `handlers::xp::curve_tests` from Task 2.

**Step 4: Manual end-to-end verification against a real Postgres**

This is the first point the migration and the DB-touching functions (`record_event`/`award`/`backfill`/the two new endpoints) run for real. From the repo root (not the worktree — reuse the existing dev Postgres/surfpool setup):

Run: `npm run setup:dev` (if not already running from prior work) then start the indexer pointed at the worktree's code — or, simpler, temporarily copy `indexer/.env` from the root repo into the worktree's `indexer/` and run `cargo run` from the worktree's `indexer/` directory. Watch the startup log for `xp backfill: granted N historical XpEvents` (or silence if there was no historical data — that's fine too), confirming the migration applied and `backfill()` ran without error.

Then hit the new endpoints directly:
```bash
curl -s http://127.0.0.1:8090/xp/<some-existing-user-id> | jq
curl -s http://127.0.0.1:8090/xp/<some-existing-user-id>/activity | jq
```
Expected: the first returns `xp`/`level`/`title`/progress fields; the second returns an `events` array with resolved `appName`/`tagName` fields where applicable.

**Step 5: Commit**

```bash
git add indexer/src/main.rs
git commit -m "feat(indexer): run XP backfill at startup"
```

---

### Task 9: App — `indexerClient.ts` additions

**Files:**
- Modify: `app/src/lib/indexerClient.ts`

**Step 1: Add the types and fetch functions**

Add near `fetchRewardsPositions` (same file, following its exact pattern):

```ts
export interface UserXp {
  userId: string;
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progress: number;
  appsSubmitted: number;
  tagsSuggested: number;
  votesCast: number;
  stakesMade: number;
}

export async function fetchUserXp(userId: string): Promise<UserXp | null> {
  return (await getOrNull(`/xp/${encodeURIComponent(userId)}`)) as UserXp | null;
}

export interface XpActivityEntry {
  id: string;
  kind: "submit_app" | "suggest_tag" | "vote" | "stake" | "daily_bonus";
  appName: string | null;
  appSlug: string | null;
  tagName: string | null;
  amount: number;
  createdAt: string;
}

export async function fetchXpActivity(userId: string): Promise<XpActivityEntry[]> {
  const result = (await get(`/xp/${encodeURIComponent(userId)}/activity`)) as {
    events: XpActivityEntry[];
  };
  return result.events;
}
```

**Step 2: Type-check**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors from this file.

**Step 3: Commit**

```bash
git add app/src/lib/indexerClient.ts
git commit -m "feat(app): add fetchUserXp/fetchXpActivity indexer client calls"
```

---

### Task 10: App — `/api/xp/me` and `/api/xp/me/activity` routes

**Files:**
- Create: `app/src/app/api/xp/me/route.ts`
- Create: `app/src/app/api/xp/me/activity/route.ts`

**Step 1: Write the XP route**

```ts
import { handler, ok } from "@/lib/api";
import { fetchUserXp } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

// GET /api/xp/me — the signed-in user's XP/level, or null if signed out.
// Same signed-out-returns-empty convention as /api/rewards/positions.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok(null);

  const xp = await fetchUserXp(session.userId);
  return ok(xp);
});
```

**Step 2: Write the activity route**

```ts
import { handler, ok } from "@/lib/api";
import { fetchXpActivity } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

// GET /api/xp/me/activity — the signed-in user's recent XP-earning events,
// newest first. Empty array for a signed-out visitor.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok([]);

  const events = await fetchXpActivity(session.userId);
  return ok(events);
});
```

**Step 3: Type-check**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors.

**Step 4: Commit**

```bash
git add app/src/app/api/xp
git commit -m "feat(app): add /api/xp/me and /api/xp/me/activity routes"
```

---

### Task 11: App — `XpProgress` component

**Files:**
- Create: `app/src/components/profile/XpProgress.tsx`

**Step 1: Write the component**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { ConnectButton } from "@/components/ConnectButton";
import type { UserXp, XpActivityEntry } from "@/lib/indexerClient";

function describeEvent(event: XpActivityEntry): string {
  switch (event.kind) {
    case "submit_app":
      return `Submitted ${event.appName ?? "an app"}`;
    case "suggest_tag":
      return `Suggested #${event.tagName ?? "a tag"} on ${event.appName ?? "an app"}`;
    case "vote":
      return `Voted on ${event.appName ?? "an app"}`;
    case "stake":
      return `Staked on #${event.tagName ?? "a tag"} (${event.appName ?? "an app"})`;
    case "daily_bonus":
      return "Daily bonus";
    default:
      return event.kind;
  }
}

export function XpProgress() {
  const { user } = useAuth();
  const [xp, setXp] = useState<UserXp | null | undefined>(undefined);
  const [activity, setActivity] = useState<XpActivityEntry[] | null>(null);

  useEffect(() => {
    if (!user) {
      setXp(null);
      setActivity(null);
      return;
    }

    let cancelled = false;

    async function load() {
      const [xpRes, activityRes] = await Promise.all([
        fetch("/api/xp/me").then((r) => r.json()),
        fetch("/api/xp/me/activity").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (xpRes.ok) setXp(xpRes.data);
      if (activityRes.ok) setActivity(activityRes.data);
    }

    load().catch(() => {
      if (!cancelled) {
        setXp(null);
        setActivity([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <section className="card space-y-3 p-6">
        <p className="text-sm text-slate">Sign in to see your level and activity.</p>
        <ConnectButton />
      </section>
    );
  }

  if (xp === undefined) {
    return (
      <section className="card p-6">
        <p className="text-sm text-slate">Loading your profile…</p>
      </section>
    );
  }

  if (xp === null) {
    return (
      <section className="card p-6">
        <p className="text-sm text-slate">Couldn&apos;t load your profile. Try refreshing.</p>
      </section>
    );
  }

  const pct = Math.round(xp.progress * 100);

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <span className="chip chip-active font-mono tabular-nums">
            Lv {xp.level} · {xp.title}
          </span>
          <span className="font-mono text-xs tabular-nums text-slate-steel">
            {xp.xpIntoLevel} / {xp.xpForNextLevel} XP
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-pill bg-mist">
          <div
            className="h-full rounded-pill bg-cobalt transition-[width] duration-250 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Apps submitted" value={xp.appsSubmitted} />
          <Stat label="Tags suggested" value={xp.tagsSuggested} />
          <Stat label="Votes cast" value={xp.votesCast} />
          <Stat label="Tags staked" value={xp.stakesMade} />
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">Activity</h2>
        {activity === null ? (
          <p className="text-sm text-slate">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-slate">
            No activity yet.{" "}
            <Link href="/" className="font-medium text-cobalt hover:underline">
              Discover an app
            </Link>{" "}
            to start earning XP.
          </p>
        ) : (
          <ul className="space-y-2">
            {activity.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hairline p-3"
              >
                <span className="text-sm text-ink">{describeEvent(event)}</span>
                <span className="font-mono text-xs tabular-nums text-forest">+{event.amount} XP</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-steel">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
```

**Step 2: Type-check**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors.

**Step 3: Commit**

```bash
git add app/src/components/profile/XpProgress.tsx
git commit -m "feat(app): add XpProgress profile component"
```

---

### Task 12: App — `/profile` page

**Files:**
- Create: `app/src/app/profile/page.tsx`

**Step 1: Write the page**

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { XpProgress } from "@/components/profile/XpProgress";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your level, XP, and activity on nebulous.world.",
  alternates: { canonical: `${SITE_URL}/profile` },
};

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your level and XP reflect how much you've contributed — voting, staking, submitting apps, and suggesting tags. It's cosmetic status only: it never affects vote weight, fees, or ranking."
      />
      <XpProgress />
    </div>
  );
}
```

**Step 2: Type-check**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors. (Confirm `SITE_URL` is exported from `@/lib/constants` — `rewards/page.tsx` already imports it from there, so this should already match.)

**Step 3: Commit**

```bash
git add app/src/app/profile/page.tsx
git commit -m "feat(app): add /profile page"
```

---

### Task 13: App — navbar level badge

**Files:**
- Create: `app/src/hooks/useUserLevel.ts`
- Modify: `app/src/components/Navbar.tsx`

**Step 1: Write the hook**

```ts
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

export interface UserLevel {
  level: number;
  title: string;
}

/** The signed-in user's XP level, for the navbar badge. `null` while signed
    out or loading — callers should just hide the badge in that case, same
    convention as `useWalletBalances`'s `neb: null`. */
export function useUserLevel(): UserLevel | null {
  const { user } = useAuth();
  const [level, setLevel] = useState<UserLevel | null>(null);

  useEffect(() => {
    if (!user) {
      setLevel(null);
      return;
    }
    let cancelled = false;
    fetch("/api/xp/me")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok && json.data) {
          setLevel({ level: json.data.level, title: json.data.title });
        }
      })
      .catch(() => {
        if (!cancelled) setLevel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return level;
}
```

**Step 2: Wire it into the navbar**

In `app/src/components/Navbar.tsx`, add the import:

```tsx
import { useUserLevel } from "@/hooks/useUserLevel";
```

Add the hook call alongside the existing `useWalletBalances` call:

```tsx
  const userLevel = useUserLevel();
```

Add the badge into the wallet-status `<div className="flex items-center gap-2">`, right after the connected-status dot and before the NEB balance chip:

```tsx
          {connected && userLevel && (
            <Link href="/profile" className="chip chip-active font-mono tabular-nums">
              Lv {userLevel.level}
            </Link>
          )}
```

(`Link` is already imported in this file.)

**Step 3: Type-check**

Run: `cd app && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors.

**Step 4: Commit**

```bash
git add app/src/hooks/useUserLevel.ts app/src/components/Navbar.tsx
git commit -m "feat(app): show XP level badge in the navbar"
```

---

### Task 14: End-to-end manual verification

**Step 1: Run the app against the indexer from Task 8**

With the indexer running (from Task 8's manual verification) and `npm run dev` running in `app/`, open the app in a browser.

**Step 2: Walk the golden path**

- Connect a wallet, submit an app or cast a vote (if dev-seeded data exists, an already-connected wallet should show non-zero XP immediately from the backfill).
- Confirm the navbar shows a `Lv N` badge next to the wallet once connected.
- Click through to `/profile` — confirm the level/title badge, XP progress bar, four lifetime-stat counts, and an activity feed entry describing the action just taken.
- Vote on a second, different app — confirm XP increases and a new activity entry appears.
- Vote again on the *same* app after withdrawing (if the UI supports withdraw) — confirm no additional XP is granted (anti-farming check from the design doc).

**Step 3: Report results**

No commit for this task — it's verification only. If anything doesn't match, fix it in the relevant earlier task's files and re-commit there (or as a small follow-up commit), then re-verify.
