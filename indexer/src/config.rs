use anyhow::{Context, Result};
use solana_pubkey::Pubkey;
use std::str::FromStr;

/// The program's real, canonical id — `declare_id!` in
/// programs/nebulous_world/src/lib.rs, same value as
/// NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID in render.yaml. Used as the
/// default so a bare `cargo run` against this repo's own deployment works
/// without any env var; PROGRAM_ID can still override it (e.g. to index a
/// different cluster's deployment).
const DEFAULT_PROGRAM_ID: &str = "EkQRRgRFd2FUedJnPVs2Xs6N7U2Jef5GrfwJ62UJZUXx";

pub struct Config {
    pub database_url: String,
    /// HTTP RPC endpoint, used for the one-shot getProgramAccounts backfill.
    pub rpc_http_url: String,
    /// WebSocket RPC endpoint, used for the ongoing `programSubscribe`
    /// stream. Most public RPC providers expose this on the same host as
    /// the HTTP endpoint with an `http(s)` -> `ws(s)` scheme swap, which
    /// `default_ws_url` below assumes if RPC_WS_URL is unset.
    pub rpc_ws_url: String,
    pub program_id: Pubkey,
    /// How often the visualization rollup task recomputes, in seconds.
    pub rollup_interval_secs: u64,
    /// How often the instruction crawler polls getSignaturesForAddress, in
    /// seconds — see src/crawler.rs for why this is polled rather than
    /// streamed.
    pub crawler_poll_interval_secs: u64,
    /// How often the platform-wide metrics snapshot (src/platform_metrics.rs)
    /// recomputes, in seconds — the time series behind the Explore page's
    /// metric trend charts. Hourly by default: frequent enough for a
    /// meaningful trend line, infrequent enough that the table doesn't grow
    /// unreasonably fast.
    pub platform_metrics_interval_secs: u64,
    /// SPL mint used for voting & staking — needed to derive `user_token_account`
    /// ATAs when building vote/stake/claim transactions (see src/api.rs).
    /// Empty in simulation mode (no mint configured yet); tx-build endpoints
    /// simply aren't reachable in that case since the app itself won't call
    /// them (see isSimulationMode() in app/src/lib/config.ts).
    pub vote_token_mint: Option<Pubkey>,
    /// Decimals of the vote/stake SPL mint — same env var and default as
    /// `voteTokenDecimals` in app/src/lib/config.ts. Used by src/reconcile.rs
    /// to scale raw on-chain u64 stake/vote amounts into the UI-unit scale
    /// `App.stakeTotal`/`voteWeight`/`AppTag.stakeTotal` are stored in.
    pub vote_token_decimals: u32,
    /// Port the HTTP API (src/api.rs) listens on.
    pub api_port: u16,
    /// Base URL of the dlmm-bridge sidecar (see dlmm-bridge/README.md).
    pub dlmm_bridge_url: String,
    /// NEB/USDC Meteora DLMM pool address (see app/scripts/launch-neb/),
    /// forwarded to the dlmm-bridge sidecar as an env var. None until the
    /// pool has been launched (see setup-dev.sh).
    pub neb_dlmm_pool: Option<String>,
    pub solana_cluster: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        // Best-effort — Render/production sets real env vars directly, this
        // is only for local `cargo run`. `indexer/` is a sibling of `app/`
        // (the Next.js app) at the repo root, and shares the same DATABASE_URL
        // and Solana config, so it's convenient to reuse app/.env directly
        // rather than requiring a second local env file.
        let _ = dotenvy::from_filename("../app/.env")
            .or_else(|_| dotenvy::from_filename("../.env"))
            .or_else(|_| dotenvy::dotenv());

        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
        let rpc_http_url = env_non_empty("NEXT_PUBLIC_SOLANA_RPC")
            .unwrap_or_else(|| "http://127.0.0.1:8899".to_string());
        // render.yaml declares RPC_WS_URL with `sync: false` and no value —
        // if Render ever materializes an unset-but-declared var as an empty
        // string rather than omitting it entirely, treating "" the same as
        // "absent" here means the derived default still kicks in instead of
        // the pipeline silently getting an empty WS URL.
        let rpc_ws_url =
            env_non_empty("RPC_WS_URL").unwrap_or_else(|| default_ws_url(&rpc_http_url));
        let program_id_str = env_non_empty("NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID")
            .unwrap_or_else(|| DEFAULT_PROGRAM_ID.to_string());
        let program_id = Pubkey::from_str(&program_id_str)
            .with_context(|| format!("invalid program id: {program_id_str}"))?;
        let rollup_interval_secs = std::env::var("ROLLUP_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);
        let crawler_poll_interval_secs = std::env::var("CRAWLER_POLL_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15);
        let platform_metrics_interval_secs = std::env::var("PLATFORM_METRICS_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3600);
        let vote_token_mint = env_non_empty("NEXT_PUBLIC_VOTE_TOKEN_MINT")
            .map(|s| Pubkey::from_str(&s))
            .transpose()
            .with_context(|| "invalid NEXT_PUBLIC_VOTE_TOKEN_MINT")?;
        let vote_token_decimals = std::env::var("NEXT_PUBLIC_VOTE_TOKEN_DECIMALS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(6);
        let api_port = std::env::var("INDEXER_API_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8090);
        let dlmm_bridge_url = env_non_empty("DLMM_BRIDGE_URL")
            .unwrap_or_else(|| "http://127.0.0.1:8091".to_string());
        let neb_dlmm_pool = env_non_empty("NEXT_PUBLIC_NEB_DLMM_POOL");
        let solana_cluster =
            env_non_empty("NEXT_PUBLIC_SOLANA_CLUSTER").unwrap_or_else(|| "devnet".to_string());

        Ok(Self {
            database_url,
            rpc_http_url,
            rpc_ws_url,
            program_id,
            rollup_interval_secs,
            crawler_poll_interval_secs,
            platform_metrics_interval_secs,
            vote_token_mint,
            vote_token_decimals,
            api_port,
            dlmm_bridge_url,
            neb_dlmm_pool,
            solana_cluster,
        })
    }
}

/// Reads an env var, treating an empty (or whitespace-only) value the same
/// as absent — several of this service's optional vars are declared with
/// `sync: false` in render.yaml, and a blank string materializing instead
/// of a genuinely missing key should still fall through to the default.
fn env_non_empty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// Derives a websocket URL from an HTTP one by swapping the scheme —
/// correct for every hosted Solana RPC provider (devnet/mainnet public RPC,
/// Helius, etc.), which all serve both protocols off the same host and
/// port. `solana-test-validator` is the one common exception: its default
/// RPC pubsub port is 8900, one above its default RPC HTTP port (8899), so
/// that specific, well-known port also gets bumped.
fn default_ws_url(http_url: &str) -> String {
    http_url
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1)
        .replacen(":8899", ":8900", 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ws_url_swaps_https_to_wss() {
        assert_eq!(
            default_ws_url("https://api.devnet.solana.com"),
            "wss://api.devnet.solana.com"
        );
    }

    #[test]
    fn default_ws_url_swaps_http_to_ws_and_bumps_the_local_validator_port() {
        assert_eq!(
            default_ws_url("http://127.0.0.1:8899"),
            "ws://127.0.0.1:8900"
        );
    }
}
