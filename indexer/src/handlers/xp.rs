//! XP & Levels — cosmetic gamification layered on existing on-chain actions
//! (submit app, suggest tag, vote, stake) plus a once-per-UTC-day bonus. See
//! docs/plans/2026-07-20-gamification-xp-levels-design.md. Never touches
//! vote weight, fees, or ranking — status only.

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
