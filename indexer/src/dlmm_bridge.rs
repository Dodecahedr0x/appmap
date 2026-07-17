//! Spawns the `dlmm-bridge` sidecar (see dlmm-bridge/README.md) as a child
//! process at startup, so `src/api.rs`'s `/pool` and `/tx/buy-neb/build`
//! handlers have something local to proxy to. A separate Node process
//! rather than native Rust: it reuses the already-tested
//! `@meteora-ag/dlmm` SDK logic that used to live in the Next.js app
//! (app/src/lib/dlmm.ts, app/src/hooks/useNebDlmmSwap.ts) rather than
//! re-deriving Meteora's bin-based AMM swap-quote math in Rust from
//! scratch — a real correctness risk for code that moves user funds, with
//! no official Rust SDK to lean on.

use crate::config::Config;
use anyhow::{Context, Result};
use std::process::Stdio;
use tokio::process::{Child, Command};

/// Spawns `node dist/index.js` (falls back to `npx tsx src/index.ts` if the
/// sidecar hasn't been built) in `indexer/dlmm-bridge`, inheriting stdout/
/// stderr so its logs interleave with the indexer's own. The child is
/// owned by a background task for the process lifetime — see the
/// `tokio::spawn` below.
pub async fn spawn(config: &Config) -> Result<()> {
    let dir = std::path::Path::new("dlmm-bridge");
    if !dir.join("package.json").exists() {
        anyhow::bail!("dlmm-bridge/ not found next to the indexer binary's working directory");
    }

    let built_entry = dir.join("dist/index.js");
    let mut command = if built_entry.exists() {
        let mut cmd = Command::new("node");
        cmd.arg("dist/index.js");
        cmd
    } else {
        let mut cmd = Command::new("npx");
        cmd.args(["tsx", "src/index.ts"]);
        cmd
    };

    let port = config
        .dlmm_bridge_url
        .rsplit(':')
        .next()
        .unwrap_or("8091")
        .to_string();

    command
        .current_dir(dir)
        .env("PORT", &port)
        .env("SOLANA_RPC_URL", &config.rpc_http_url)
        .env("SOLANA_CLUSTER", &config.solana_cluster);
    if let Some(pool) = &config.neb_dlmm_pool {
        command.env("NEB_DLMM_POOL", pool);
    }

    let mut child: Child = command
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .context("failed to spawn dlmm-bridge (did you run `npm install` in indexer/dlmm-bridge?)")?;

    log::info!(
        "dlmm-bridge sidecar started (pid {:?}) on port {port}",
        child.id()
    );
    // Own the Child for the process lifetime by awaiting it on a background
    // task (rather than dropping the handle, which wouldn't kill the OS
    // process either way but would stop us from ever noticing if it dies).
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => log::warn!("dlmm-bridge sidecar exited: {status}"),
            Err(e) => log::error!("dlmm-bridge sidecar wait() failed: {e}"),
        }
    });
    Ok(())
}
