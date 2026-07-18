//! Ports of `app/src/lib/ranking.ts` (rank scoring) and `app/src/lib/
//! revenue.ts` (ad-revenue distribution), plus `app/src/lib/engine.ts`'s
//! DB-touching wrappers around them (`refreshApp`/`refreshAppTag`/
//! `refreshAllRankScores`) — the app used to own this database-facing
//! bridge layer directly via Prisma; now the indexer does, and every
//! remaining route that used to call into `engine.ts` calls these functions
//! instead. Kept numerically identical to the TS originals (same weights,
//! same rounding), not reimagined — this is a port, not a redesign.

use crate::api::ApiError;
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::PgPool;

/// Prisma's `DateTime` fields map to Postgres `TIMESTAMP(3)` — WITHOUT time
/// zone (see `indexer/migrations/005_app_schema.sql`) — so sqlx must decode
/// them as `NaiveDateTime`, not `DateTime<Utc>` (which requires
/// `TIMESTAMPTZ`). Every value in these columns is written by `now()` and
/// treated as UTC by convention (same as Prisma's own behavior), so this
/// just re-attaches the `Z` offset for JSON serialization / RFC3339 output.
pub fn to_rfc3339(naive: NaiveDateTime) -> String {
    DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc).to_rfc3339()
}

// --- ranking.ts ---

pub struct RankInputs {
    pub vote_weight: f64,
    pub stake_total: f64,
    pub view_count: f64,
    pub age_days: f64,
}

const RANK_WEIGHT_VOTE: f64 = 1.0;
const RANK_WEIGHT_STAKE: f64 = 0.8;
const RANK_WEIGHT_TRAFFIC: f64 = 0.35;
const RANK_FRESHNESS_BONUS: f64 = 1.5;
const RANK_FRESHNESS_HALF_LIFE_DAYS: f64 = 14.0;

fn log10p1(x: f64) -> f64 {
    (1.0 + x.max(0.0)).log10()
}

fn round_to(x: f64, decimals: i32) -> f64 {
    let f = 10f64.powi(decimals);
    (x * f).round() / f
}

/// Same formula as `ranking.ts`'s `computeRankScore` — see that file for the
/// design rationale (log-damping so no single whale dominates, freshness
/// bonus that decays with a half-life).
pub fn compute_rank_score(inputs: &RankInputs) -> f64 {
    let vote_score = RANK_WEIGHT_VOTE * log10p1(inputs.vote_weight);
    let stake_score = RANK_WEIGHT_STAKE * log10p1(inputs.stake_total);
    let traffic_score = RANK_WEIGHT_TRAFFIC * log10p1(inputs.view_count);
    let decay = 0.5f64.powf(inputs.age_days.max(0.0) / RANK_FRESHNESS_HALF_LIFE_DAYS);
    let freshness = RANK_FRESHNESS_BONUS * decay;
    round_to(vote_score + stake_score + traffic_score + freshness, 6)
}

pub fn age_in_days(created_at: NaiveDateTime, now: NaiveDateTime) -> f64 {
    (now - created_at).num_milliseconds() as f64 / (1000.0 * 60.0 * 60.0 * 24.0)
}

/// Same formula as `ranking.ts`'s `combineSearchScore`.
pub fn combine_search_score(text_score: f64, rank_score: f64, max_rank_score: f64) -> f64 {
    let normalized_rank = if max_rank_score > 0.0 { rank_score / max_rank_score } else { 0.0 };
    if text_score <= 0.0 {
        normalized_rank
    } else {
        text_score * 0.7 + normalized_rank * 0.3
    }
}

// --- revenue.ts ---

pub const PROTOCOL_FEE: f64 = 0.1;
pub const APP_TAG_SPLIT: f64 = 0.5;

#[derive(Clone)]
pub struct StakePosition {
    pub user_id: String,
    pub stake: f64,
}

pub struct RevenueShare {
    pub user_id: String,
    pub amount: f64,
}

pub struct DistributionResult {
    pub shares: Vec<RevenueShare>,
}

fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    x.max(lo).min(hi)
}

/// Same formula as `revenue.ts`'s `distributeRevenue` — protocol fee off the
/// top, remainder split pro-rata by stake, last staker absorbs rounding
/// dust so shares sum exactly to the distributable amount.
pub fn distribute_revenue(gross: f64, positions: &[StakePosition], fee_rate: f64) -> DistributionResult {
    let safe_gross = gross.max(0.0);
    let fee = round_to(safe_gross * clamp(fee_rate, 0.0, 1.0), 9);
    let distributable = round_to(safe_gross - fee, 9);

    let active: Vec<&StakePosition> = positions.iter().filter(|p| p.stake > 0.0).collect();
    let total_stake: f64 = active.iter().map(|p| p.stake).sum();

    if total_stake <= 0.0 || distributable <= 0.0 {
        return DistributionResult { shares: vec![] };
    }

    // Aggregate by user in case the same user appears more than once.
    let mut by_user: Vec<(String, f64)> = Vec::new();
    for p in &active {
        if let Some(entry) = by_user.iter_mut().find(|(id, _)| id == &p.user_id) {
            entry.1 += p.stake;
        } else {
            by_user.push((p.user_id.clone(), p.stake));
        }
    }

    let mut allocated = 0.0;
    let mut shares = Vec::with_capacity(by_user.len());
    let n = by_user.len();
    for (i, (user_id, stake)) in by_user.into_iter().enumerate() {
        let share_of_pool = stake / total_stake;
        let is_last = i == n - 1;
        let amount = if is_last {
            round_to(distributable - allocated, 9)
        } else {
            round_to(distributable * share_of_pool, 9)
        };
        allocated = round_to(allocated + amount, 9);
        shares.push(RevenueShare { user_id, amount });
    }

    DistributionResult { shares }
}

pub struct AppRevenueSplit {
    pub vote_pool: DistributionResult,
    pub tag_pool: DistributionResult,
}

/// Same formula as `revenue.ts`'s `distributeAppRevenue` — fee taken once on
/// the combined gross, remainder split 50/50 between voters and taggers
/// unless one side is empty (in which case its half rolls to the other).
pub fn distribute_app_revenue(
    gross: f64,
    vote_positions: &[StakePosition],
    tag_positions: &[StakePosition],
    fee_rate: f64,
) -> AppRevenueSplit {
    let safe_gross = gross.max(0.0);
    let fee = round_to(safe_gross * clamp(fee_rate, 0.0, 1.0), 9);
    let distributable = round_to(safe_gross - fee, 9);

    let has_voters = vote_positions.iter().any(|p| p.stake > 0.0);
    let has_taggers = tag_positions.iter().any(|p| p.stake > 0.0);

    let mut vote_share = round_to(distributable * APP_TAG_SPLIT, 9);
    let mut tag_share = round_to(distributable - vote_share, 9);

    if !has_taggers {
        vote_share = distributable;
        tag_share = 0.0;
    } else if !has_voters {
        tag_share = distributable;
        vote_share = 0.0;
    }

    AppRevenueSplit {
        vote_pool: distribute_revenue(vote_share, vote_positions, 0.0),
        tag_pool: distribute_revenue(tag_share, tag_positions, 0.0),
    }
}

pub fn revenue_per_impression(cpm: f64) -> f64 {
    round_to(cpm.max(0.0) / 1000.0, 9)
}

// --- engine.ts's DB-touching wrappers ---

/// Recompute `App`'s cached aggregate fields (voteWeight/voteCount/
/// stakeTotal/viewCount/rankScore) from its raw votes/stakes/page views.
/// Same shape as `engine.ts`'s `refreshApp` — call after any vote/stake/
/// view mutation.
pub async fn refresh_app(pool: &PgPool, app_id: &str) -> Result<(), ApiError> {
    let Some(created_at): Option<NaiveDateTime> =
        sqlx::query_scalar(r#"SELECT "createdAt" FROM "App" WHERE id = $1"#)
            .bind(app_id)
            .fetch_optional(pool)
            .await
            .map_err(crate::api::internal)?
    else {
        return Ok(());
    };

    let vote_weight: f64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount), 0) FROM "Vote" WHERE "appId" = $1 AND active = true"#,
    )
    .bind(app_id)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    let vote_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "Vote" WHERE "appId" = $1 AND active = true"#,
    )
    .bind(app_id)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    let view_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "PageView" WHERE "appId" = $1"#)
        .bind(app_id)
        .fetch_one(pool)
        .await
        .map_err(crate::api::internal)?;

    let stake_total: f64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(s.amount), 0)
        FROM "Stake" s
        JOIN "AppTag" at ON at.id = s."appTagId"
        WHERE at."appId" = $1 AND s.active = true
        "#,
    )
    .bind(app_id)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    let rank_score = compute_rank_score(&RankInputs {
        vote_weight,
        stake_total,
        view_count: view_count as f64,
        age_days: age_in_days(created_at, Utc::now().naive_utc()),
    });

    sqlx::query(
        r#"
        UPDATE "App"
        SET "voteWeight" = $2, "voteCount" = $3, "stakeTotal" = $4, "viewCount" = $5, "rankScore" = $6, "updatedAt" = now()
        WHERE id = $1
        "#,
    )
    .bind(app_id)
    .bind(vote_weight)
    .bind(vote_count as i32)
    .bind(stake_total)
    .bind(view_count as i32)
    .bind(rank_score)
    .execute(pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(())
}

/// Recompute one `AppTag`'s cached `stakeTotal`. Same shape as `engine.ts`'s
/// `refreshAppTag`.
pub async fn refresh_app_tag(pool: &PgPool, app_tag_id: &str) -> Result<(), ApiError> {
    let stake_total: f64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount), 0) FROM "Stake" WHERE "appTagId" = $1 AND active = true"#,
    )
    .bind(app_tag_id)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    sqlx::query(r#"UPDATE "AppTag" SET "stakeTotal" = $2 WHERE id = $1"#)
        .bind(app_tag_id)
        .bind(stake_total)
        .execute(pool)
        .await
        .map_err(crate::api::internal)?;

    Ok(())
}

/// Recompute rank scores for every app (freshness decay needs to apply even
/// to apps with no new activity) — same shape as `engine.ts`'s
/// `refreshAllRankScores`. Intended to run periodically.
pub async fn refresh_all_rank_scores(pool: &PgPool) -> Result<usize, ApiError> {
    let rows: Vec<(String, f64, f64, i32, NaiveDateTime)> = sqlx::query_as(
        r#"SELECT id, "voteWeight", "stakeTotal", "viewCount", "createdAt" FROM "App""#,
    )
    .fetch_all(pool)
    .await
    .map_err(crate::api::internal)?;

    let now = Utc::now().naive_utc();
    for (id, vote_weight, stake_total, view_count, created_at) in &rows {
        let rank_score = compute_rank_score(&RankInputs {
            vote_weight: *vote_weight,
            stake_total: *stake_total,
            view_count: *view_count as f64,
            age_days: age_in_days(*created_at, now),
        });
        sqlx::query(r#"UPDATE "App" SET "rankScore" = $2, "updatedAt" = now() WHERE id = $1"#)
            .bind(id)
            .bind(rank_score)
            .execute(pool)
            .await
            .map_err(crate::api::internal)?;
    }

    Ok(rows.len())
}

/// Ported from `app/src/lib/ranking.test.ts` + `revenue.test.ts` — same
/// assertions, now exercising the Rust port instead of the deleted TS
/// originals.
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, eps: f64) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn rank_score_is_freshness_bonus_alone_for_a_brand_new_empty_app() {
        let score = compute_rank_score(&RankInputs { vote_weight: 0.0, stake_total: 0.0, view_count: 0.0, age_days: 0.0 });
        assert!(close(score, RANK_FRESHNESS_BONUS, 1e-6));
    }

    #[test]
    fn rank_score_increases_with_more_votes() {
        let low = compute_rank_score(&RankInputs { vote_weight: 10.0, stake_total: 0.0, view_count: 0.0, age_days: 100.0 });
        let high = compute_rank_score(&RankInputs { vote_weight: 1000.0, stake_total: 0.0, view_count: 0.0, age_days: 100.0 });
        assert!(high > low);
    }

    #[test]
    fn rank_score_freshness_bonus_halves_after_one_half_life() {
        let fresh = compute_rank_score(&RankInputs { vote_weight: 0.0, stake_total: 0.0, view_count: 0.0, age_days: 0.0 });
        let aged = compute_rank_score(&RankInputs {
            vote_weight: 0.0,
            stake_total: 0.0,
            view_count: 0.0,
            age_days: RANK_FRESHNESS_HALF_LIFE_DAYS,
        });
        assert!(close(aged, fresh / 2.0, 1e-4));
    }

    #[test]
    fn rank_score_never_goes_negative_for_negative_inputs() {
        let score = compute_rank_score(&RankInputs { vote_weight: -5.0, stake_total: -5.0, view_count: -5.0, age_days: 0.0 });
        assert!(score >= 0.0);
    }

    #[test]
    fn combine_search_score_is_pure_normalized_rank_with_no_query() {
        assert!(close(combine_search_score(0.0, 5.0, 10.0), 0.5, 1e-6));
    }

    #[test]
    fn combine_search_score_weights_text_70_rank_30_with_a_query() {
        let score = combine_search_score(1.0, 5.0, 10.0);
        assert!(close(score, 0.7 * 1.0 + 0.3 * 0.5, 1e-6));
    }

    fn total(result: &DistributionResult) -> f64 {
        result.shares.iter().map(|s| s.amount).sum()
    }

    #[test]
    fn distribute_revenue_splits_pro_rata_after_fee() {
        // gross 100, fee 10% = 10, distributable 90, split 75/25 by stake.
        let result = distribute_revenue(
            100.0,
            &[
                StakePosition { user_id: "a".into(), stake: 75.0 },
                StakePosition { user_id: "b".into(), stake: 25.0 },
            ],
            PROTOCOL_FEE,
        );
        assert!(close(result.shares.iter().find(|s| s.user_id == "a").unwrap().amount, 67.5, 1e-6));
        assert!(close(result.shares.iter().find(|s| s.user_id == "b").unwrap().amount, 22.5, 1e-6));
    }

    #[test]
    fn distribute_revenue_sums_shares_to_exactly_distributable_no_rounding_dust() {
        let result = distribute_revenue(
            10.0,
            &[
                StakePosition { user_id: "a".into(), stake: 1.0 },
                StakePosition { user_id: "b".into(), stake: 1.0 },
                StakePosition { user_id: "c".into(), stake: 1.0 },
            ],
            PROTOCOL_FEE,
        );
        assert!(close(total(&result), 9.0, 1e-9)); // 10 - 10% fee = 9
    }

    #[test]
    fn distribute_revenue_aggregates_multiple_positions_from_the_same_user() {
        let result = distribute_revenue(
            100.0,
            &[
                StakePosition { user_id: "a".into(), stake: 50.0 },
                StakePosition { user_id: "a".into(), stake: 50.0 },
            ],
            PROTOCOL_FEE,
        );
        assert_eq!(result.shares.len(), 1);
        assert!(close(result.shares[0].amount, 90.0, 1e-6));
    }

    #[test]
    fn distribute_revenue_returns_no_shares_with_no_stakers() {
        let result = distribute_revenue(100.0, &[], PROTOCOL_FEE);
        assert_eq!(result.shares.len(), 0);
    }

    #[test]
    fn distribute_revenue_ignores_zero_and_negative_stake_positions() {
        let result = distribute_revenue(
            100.0,
            &[
                StakePosition { user_id: "a".into(), stake: 10.0 },
                StakePosition { user_id: "b".into(), stake: 0.0 },
                StakePosition { user_id: "c".into(), stake: -5.0 },
            ],
            PROTOCOL_FEE,
        );
        assert_eq!(result.shares.len(), 1);
        assert_eq!(result.shares[0].user_id, "a");
        assert!(close(result.shares[0].amount, 90.0, 1e-6));
    }

    #[test]
    fn distribute_revenue_respects_a_custom_fee_rate() {
        let result = distribute_revenue(100.0, &[StakePosition { user_id: "a".into(), stake: 10.0 }], 0.5);
        assert!(close(result.shares[0].amount, 50.0, 1e-6));
    }

    #[test]
    fn revenue_per_impression_divides_cpm_by_1000() {
        assert!(close(revenue_per_impression(2.5), 0.0025, 1e-9));
    }

    #[test]
    fn distribute_app_revenue_splits_50_50_between_pools() {
        // gross 200, fee 10% = 20, distributable 180, split 90/90.
        let result = distribute_app_revenue(
            200.0,
            &[StakePosition { user_id: "voter".into(), stake: 10.0 }],
            &[StakePosition { user_id: "tagger".into(), stake: 10.0 }],
            PROTOCOL_FEE,
        );
        assert!(close(total(&result.vote_pool), 90.0, 1e-6));
        assert!(close(total(&result.tag_pool), 90.0, 1e-6));
    }

    #[test]
    fn distribute_app_revenue_rolls_tags_into_vote_pool_when_no_tag_stakers() {
        let result = distribute_app_revenue(200.0, &[StakePosition { user_id: "voter".into(), stake: 10.0 }], &[], PROTOCOL_FEE);
        assert!(close(total(&result.vote_pool), 180.0, 1e-6));
        assert_eq!(result.tag_pool.shares.len(), 0);
    }

    #[test]
    fn distribute_app_revenue_rolls_votes_into_tag_pool_when_no_voters() {
        let result = distribute_app_revenue(200.0, &[], &[StakePosition { user_id: "tagger".into(), stake: 10.0 }], PROTOCOL_FEE);
        assert!(close(total(&result.tag_pool), 180.0, 1e-6));
    }

    #[test]
    fn distribute_app_revenue_retains_everything_when_neither_pool_has_positions() {
        let result = distribute_app_revenue(200.0, &[], &[], PROTOCOL_FEE);
        assert_eq!(result.vote_pool.shares.len(), 0);
        assert_eq!(result.tag_pool.shares.len(), 0);
    }
}
