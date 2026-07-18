//! Ports `engine.ts`'s `settleEpoch` (the revenue-distribution transaction —
//! see `handlers/engine.rs` for the pure `distribute_app_revenue` math it's
//! built on) plus two periodic-job endpoints `scripts/settleEpoch.ts`'s
//! sibling scripts used to call via Prisma directly: `refreshAllRankScores`
//! and `writeDailySnapshot`. `scripts/settleEpoch.ts`/`dailySnapshot.ts`
//! now call these over HTTP instead — see AGENTS.md.

use crate::api::ApiError;
use crate::handlers::engine::{distribute_app_revenue, refresh_all_rank_scores, StakePosition, PROTOCOL_FEE};
use crate::api::ApiState;
use axum::extract::{Json, Path, State};
use axum::routing::post;
use axum::Router;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettleResultDto {
    gross: f64,
    claims: usize,
}

/// Same shape as `engine.ts`'s `settleEpoch`.
async fn settle_epoch_impl(pool: &PgPool, epoch_id: &str) -> Result<SettleResultDto, ApiError> {
    type EpochRow = (String, NaiveDateTime, NaiveDateTime, f64, bool);
    let epoch: Option<EpochRow> = sqlx::query_as(
        r#"SELECT "appId", "periodStart", "periodEnd", "grossRevenue", distributed FROM "RevenueEpoch" WHERE id = $1"#,
    )
    .bind(epoch_id)
    .fetch_optional(pool)
    .await
    .map_err(crate::api::internal)?;
    let Some((app_id, period_start, period_end, gross_revenue, distributed)) = epoch else {
        return Err(crate::api::not_found(format!("Epoch {epoch_id} not found")));
    };
    if distributed {
        return Ok(SettleResultDto { gross: gross_revenue, claims: 0 });
    }

    let gross: f64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(revenue), 0) FROM "AdImpression"
        WHERE "appId" = $1 AND "epochId" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3
        "#,
    )
    .bind(&app_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    let vote_positions: Vec<StakePosition> = sqlx::query_as::<_, (String, f64)>(
        r#"SELECT "userId", amount FROM "Vote" WHERE "appId" = $1 AND active = true"#,
    )
    .bind(&app_id)
    .fetch_all(pool)
    .await
    .map_err(crate::api::internal)?
    .into_iter()
    .map(|(user_id, stake)| StakePosition { user_id, stake })
    .collect();

    let tag_positions: Vec<StakePosition> = sqlx::query_as::<_, (String, f64)>(
        r#"
        SELECT s."userId", s.amount
        FROM "Stake" s JOIN "AppTag" at ON at.id = s."appTagId"
        WHERE at."appId" = $1 AND s.active = true
        "#,
    )
    .bind(&app_id)
    .fetch_all(pool)
    .await
    .map_err(crate::api::internal)?
    .into_iter()
    .map(|(user_id, stake)| StakePosition { user_id, stake })
    .collect();

    let split = distribute_app_revenue(gross, &vote_positions, &tag_positions, PROTOCOL_FEE);
    let all_shares: Vec<_> = split.vote_pool.shares.into_iter().chain(split.tag_pool.shares).collect();

    let mut tx = pool.begin().await.map_err(crate::api::internal)?;

    sqlx::query(
        r#"
        UPDATE "AdImpression" SET "epochId" = $1
        WHERE "appId" = $2 AND "epochId" IS NULL AND "createdAt" >= $3 AND "createdAt" < $4
        "#,
    )
    .bind(epoch_id)
    .bind(&app_id)
    .bind(period_start)
    .bind(period_end)
    .execute(&mut *tx)
    .await
    .map_err(crate::api::internal)?;

    // A user present in both pools contributes two shares here, which must
    // ADD together into one row — same as engine.ts's upsert with
    // `update: { amount: { increment } }`.
    for share in &all_shares {
        sqlx::query(
            r#"
            INSERT INTO "RevenueClaim" (id, "epochId", "userId", amount, "createdAt")
            VALUES (gen_random_uuid()::text, $1, $2, $3, now())
            ON CONFLICT ("epochId", "userId") DO UPDATE SET amount = "RevenueClaim".amount + EXCLUDED.amount
            "#,
        )
        .bind(epoch_id)
        .bind(&share.user_id)
        .bind(share.amount)
        .execute(&mut *tx)
        .await
        .map_err(crate::api::internal)?;
    }

    sqlx::query(
        r#"UPDATE "RevenueEpoch" SET "grossRevenue" = $2, distributed = true, "closedAt" = now() WHERE id = $1"#,
    )
    .bind(epoch_id)
    .bind(gross)
    .execute(&mut *tx)
    .await
    .map_err(crate::api::internal)?;

    tx.commit().await.map_err(crate::api::internal)?;

    Ok(SettleResultDto { gross, claims: all_shares.len() })
}

async fn settle_epoch(State(state): State<Arc<ApiState>>, Path(epoch_id): Path<String>) -> Result<Json<SettleResultDto>, ApiError> {
    Ok(Json(settle_epoch_impl(&state.pool, &epoch_id).await?))
}

async fn refresh_rank_scores(State(state): State<Arc<ApiState>>) -> Result<Json<serde_json::Value>, ApiError> {
    let count = refresh_all_rank_scores(&state.pool).await?;
    Ok(Json(serde_json::json!({ "refreshed": count })))
}

/// Same shape as `snapshot.ts`'s `writeDailySnapshot` — one `AppStatsSnapshot`
/// row per app for today (UTC), upserted so a same-day re-run updates
/// rather than duplicates.
async fn write_daily_snapshot(State(state): State<Arc<ApiState>>) -> Result<Json<serde_json::Value>, ApiError> {
    let apps: Vec<(String, f64, f64, i32, f64)> = sqlx::query_as(
        r#"SELECT id, "voteWeight", "stakeTotal", "viewCount", "rankScore" FROM "App""#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    for (id, vote_weight, stake_total, view_count, rank_score) in &apps {
        sqlx::query(
            r#"
            INSERT INTO "AppStatsSnapshot" (id, "appId", date, "voteWeight", "stakeTotal", "viewCount", "rankScore", "createdAt")
            VALUES (gen_random_uuid()::text, $1, date_trunc('day', now()), $2, $3, $4, $5, now())
            ON CONFLICT ("appId", date) DO UPDATE SET
                "voteWeight" = EXCLUDED."voteWeight",
                "stakeTotal" = EXCLUDED."stakeTotal",
                "viewCount" = EXCLUDED."viewCount",
                "rankScore" = EXCLUDED."rankScore"
            "#,
        )
        .bind(id)
        .bind(vote_weight)
        .bind(stake_total)
        .bind(view_count)
        .bind(rank_score)
        .execute(&state.pool)
        .await
        .map_err(crate::api::internal)?;
    }

    Ok(Json(serde_json::json!({ "written": apps.len() })))
}

#[derive(serde::Deserialize)]
struct TrafficQuery {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

/// Revenue-eligible page-view count per app in `[start, end)` — used by
/// `scripts/settleEpoch.ts` to allocate AdSense earnings by traffic share.
/// One query for every app rather than N+1 (the original TS looped
/// `prisma.pageView.count` per app).
async fn traffic(
    State(state): State<Arc<ApiState>>,
    axum::extract::Query(q): axum::extract::Query<TrafficQuery>,
) -> Result<Json<std::collections::HashMap<String, i64>>, ApiError> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT "appId", COUNT(*) FROM "PageView"
        WHERE "revenueEligible" = true AND "createdAt" >= $1 AND "createdAt" < $2
        GROUP BY "appId"
        "#,
    )
    .bind(q.start.naive_utc())
    .bind(q.end.naive_utc())
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(rows.into_iter().collect()))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/revenue/epochs/:id/settle", post(settle_epoch))
        .route("/rank-scores/refresh", post(refresh_rank_scores))
        .route("/snapshots/daily", post(write_daily_snapshot))
        .route("/platform/traffic", axum::routing::get(traffic))
}
