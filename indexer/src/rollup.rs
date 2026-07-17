use anyhow::Result;
use sqlx::PgPool;
use std::time::Duration;

/// The indexer's explicit "processing task for visualization" responsibility
/// — distinct from the event-driven account/instruction processors, which
/// only ever write what they individually observe. On a fixed interval,
/// rolls up how many of each instruction type landed on-chain into
/// `visualization_rollup` — the raw material for an on-chain-activity
/// chart, computed once so consumers never have to aggregate the
/// (potentially large) raw `indexed_instruction` log themselves.
pub async fn run(pool: PgPool, interval_secs: u64) {
    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    loop {
        ticker.tick().await;
        if let Err(e) = roll_up_once(&pool, interval_secs).await {
            log::error!("visualization rollup failed: {e}");
        }
    }
}

async fn roll_up_once(pool: &PgPool, interval_secs: u64) -> Result<()> {
    // Scans everything indexed since the last tick (by insertion time, so a
    // catch-up burst after downtime is never missed), but buckets each row
    // by its real on-chain `block_time` (falling back to `indexed_at` only
    // for the rare row with no block_time). Bucketing by insertion time
    // instead would make a catch-up burst look like an artificial activity
    // spike at "now" rather than reflecting when the activity actually
    // happened on-chain — a single tick can therefore fan out into several
    // historical buckets, and the same bucket can accumulate contributions
    // across more than one tick (hence the `+` in the upsert, not an
    // overwrite).
    let scan_end = chrono::Utc::now();
    let scan_start = scan_end - chrono::Duration::seconds(interval_secs as i64);
    let interval_secs_i64 = interval_secs as i64;

    let result = sqlx::query(
        r#"
        INSERT INTO visualization_rollup (bucket_start, bucket_end, instruction_name, event_count)
        SELECT
            to_timestamp(floor(extract(epoch FROM COALESCE(block_time, indexed_at)) / $3) * $3) AS bucket_start,
            to_timestamp(floor(extract(epoch FROM COALESCE(block_time, indexed_at)) / $3) * $3 + $3) AS bucket_end,
            instruction_name,
            count(*) AS event_count
        FROM indexed_instruction
        WHERE indexed_at >= $1 AND indexed_at < $2
        GROUP BY 1, 2, instruction_name
        ON CONFLICT (bucket_start, instruction_name) DO UPDATE SET
            event_count = visualization_rollup.event_count + EXCLUDED.event_count,
            bucket_end = EXCLUDED.bucket_end,
            computed_at = now()
        "#,
    )
    .bind(scan_start)
    .bind(scan_end)
    .bind(interval_secs_i64)
    .execute(pool)
    .await?;

    log::debug!(
        "visualization rollup: {} bucket rows touched from [{scan_start}, {scan_end})",
        result.rows_affected()
    );
    Ok(())
}
