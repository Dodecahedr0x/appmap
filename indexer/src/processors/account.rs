use async_trait::async_trait;
use carbon_core::account::{AccountMetadata, AccountProcessorInputType, DecodedAccount};
use carbon_core::error::CarbonResult;
use carbon_core::metrics::MetricsCollection;
use carbon_core::processor::Processor;
use carbon_nebulous_world_decoder::accounts::NebulousWorldAccount;
use sqlx::PgPool;
use std::sync::Arc;

fn account_type_name(account: &NebulousWorldAccount) -> &'static str {
    match account {
        NebulousWorldAccount::AppAccount(_) => "AppAccount",
        NebulousWorldAccount::AppTagStake(_) => "AppTagStake",
        NebulousWorldAccount::Config(_) => "Config",
        NebulousWorldAccount::StakePosition(_) => "StakePosition",
        NebulousWorldAccount::Tag(_) => "Tag",
        NebulousWorldAccount::VotePosition(_) => "VotePosition",
    }
}

/// Postgres BIGINT is a signed i64; every value stored here originates as a
/// u64 on-chain, and while none of them are realistically anywhere near
/// u64::MAX at this app's scale, the on-chain program itself only ever
/// checks values are nonzero, not an upper bound — silently wrapping an
/// oversized value negative via `as i64` would corrupt whichever row it
/// lands in. Reject and skip instead.
fn to_pg_i64(value: u64, field: &str) -> CarbonResult<i64> {
    i64::try_from(value).map_err(|_| {
        carbon_core::error::Error::Custom(format!(
            "{field} value {value} does not fit in Postgres BIGINT"
        ))
    })
}

/// Upserts one decoded account's current state into `indexed_account`.
/// Shared between the live pipeline processor below and the one-shot
/// startup backfill (src/backfill.rs), so both paths write identically
/// instead of duplicating the upsert logic.
pub async fn index_account(
    pool: &PgPool,
    metadata: &AccountMetadata,
    decoded: &DecodedAccount<NebulousWorldAccount>,
) -> CarbonResult<()> {
    let pubkey = metadata.pubkey.to_string();
    let account_type = account_type_name(&decoded.data);
    let data = serde_json::to_value(&decoded.data)
        .map_err(|e| carbon_core::error::Error::Custom(e.to_string()))?;
    let lamports = to_pg_i64(decoded.lamports, "lamports")?;
    let slot = to_pg_i64(metadata.slot, "slot")?;

    let result = sqlx::query(
        r#"
        INSERT INTO indexed_account (pubkey, account_type, owner, lamports, slot, data, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (pubkey) DO UPDATE SET
            account_type = EXCLUDED.account_type,
            owner = EXCLUDED.owner,
            lamports = EXCLUDED.lamports,
            slot = EXCLUDED.slot,
            data = EXCLUDED.data,
            updated_at = now()
        WHERE indexed_account.slot <= EXCLUDED.slot
        "#,
    )
    .bind(&pubkey)
    .bind(account_type)
    .bind(decoded.owner.to_string())
    .bind(lamports)
    .bind(slot)
    .bind(&data)
    .execute(pool)
    .await
    .map_err(|e| carbon_core::error::Error::Custom(e.to_string()))?;

    if result.rows_affected() == 0 {
        // Either a brand-new row (rows_affected is 0 on ON CONFLICT
        // DO UPDATE's guard failing, not on plain INSERT) — check which:
        // sqlx reports 1 for a fresh INSERT, so 0 here specifically means
        // the WHERE guard rejected a stale (out-of-order) update.
        log::debug!(
            "skipped stale {account_type} update for {pubkey} at slot {} (already have a newer one)",
            metadata.slot
        );
        return Ok(());
    }

    Ok(())
}

pub struct AccountProcessor {
    pub pool: PgPool,
}

#[async_trait]
impl Processor for AccountProcessor {
    type InputType = AccountProcessorInputType<NebulousWorldAccount>;

    async fn process(
        &mut self,
        (metadata, decoded, _raw): Self::InputType,
        _metrics: Arc<MetricsCollection>,
    ) -> CarbonResult<()> {
        if let Err(e) = index_account(&self.pool, &metadata, &decoded).await {
            log::error!("failed to index account {}: {e}", metadata.pubkey);
            return Err(e);
        }
        log::debug!(
            "indexed {} account {} at slot {}",
            account_type_name(&decoded.data),
            metadata.pubkey,
            metadata.slot
        );
        Ok(())
    }
}
