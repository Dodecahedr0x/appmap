use crate::processors::account::index_account;
use anyhow::Result;
use carbon_core::account::{AccountDecoder, AccountMetadata};
use carbon_nebulous_world_decoder::NebulousWorldDecoder;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_pubkey::Pubkey;
use sqlx::PgPool;

/// One-shot snapshot of "the state of all accounts" owned by the program,
/// run once at startup via `getProgramAccounts` before the live pipeline
/// (which only ever streams *future* changes — a fresh `programSubscribe`
/// WebSocket has no memory of state that existed before it connected) takes
/// over. Every account is stamped with the single slot fetched just before
/// the request, a reasonable approximation of "all of this existed
/// as-of-roughly this slot" for what is fundamentally a point-in-time bulk
/// read, not a set of individually time-stamped updates.
pub async fn run(rpc_http_url: &str, program_id: Pubkey, pool: &PgPool) -> Result<()> {
    let client = RpcClient::new(rpc_http_url.to_string());
    let slot = client.get_slot().await?;
    let accounts = client.get_program_accounts(&program_id).await?;
    log::info!(
        "backfill: fetched {} accounts owned by {program_id} at slot {slot}",
        accounts.len()
    );

    let decoder = NebulousWorldDecoder;
    let mut indexed = 0u32;
    for (pubkey, account) in &accounts {
        let Some(decoded) = decoder.decode_account(account) else {
            continue;
        };
        let metadata = AccountMetadata {
            slot,
            pubkey: *pubkey,
            transaction_signature: None,
        };
        match index_account(pool, &metadata, &decoded).await {
            Ok(()) => indexed += 1,
            Err(e) => log::error!("backfill: failed to index {pubkey}: {e}"),
        }
    }
    log::info!("backfill: indexed {indexed} decodable accounts");
    Ok(())
}
