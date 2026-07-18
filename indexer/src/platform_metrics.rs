use anyhow::Result;
use sqlx::PgPool;
use std::time::Duration;

/// Periodically snapshots platform-wide, on-chain-derived metrics (apps
/// indexed, tags indexed, total vote stake, total tag stake) into
/// `platform_metrics_snapshot` — the time series behind the Explore page's
/// metric trend charts. Unlike rollup.rs's additive bucket rollup, this is
/// a point-in-time gauge: one fresh row per tick, no upsert.
pub async fn run(pool: PgPool, interval_secs: u64) {
    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    loop {
        ticker.tick().await;
        if let Err(e) = snapshot_once(&pool).await {
            log::error!("platform metrics snapshot failed: {e}");
        }
    }
}

async fn snapshot_once(pool: &PgPool) -> Result<()> {
    // Reads straight from indexed_account's decoded on-chain state — the
    // same Carbon-verified truth the /accounts/* endpoints serve — rather
    // than any app-side cached counter. account_type disambiguates the
    // heterogeneous JSONB rows (see processors/account.rs); `data->'data'`
    // unwraps the {"type","data"} envelope (see api.rs's fetch_account).
    let result = sqlx::query(
        r#"
        INSERT INTO platform_metrics_snapshot
            (app_count, tag_count, total_vote_stake, total_tag_stake)
        SELECT
            count(*) FILTER (WHERE account_type = 'AppAccount'),
            count(*) FILTER (WHERE account_type = 'Tag'),
            COALESCE(SUM((data->'data'->>'total_vote_stake')::bigint)
                FILTER (WHERE account_type = 'AppAccount'), 0),
            COALESCE(SUM((data->'data'->>'total_tag_stake')::bigint)
                FILTER (WHERE account_type = 'AppAccount'), 0)
        FROM indexed_account
        WHERE account_type IN ('AppAccount', 'Tag')
        "#,
    )
    .execute(pool)
    .await?;

    log::debug!(
        "platform metrics snapshot: {} row inserted",
        result.rows_affected()
    );
    Ok(())
}
