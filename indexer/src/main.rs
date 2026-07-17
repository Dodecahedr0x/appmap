mod backfill;
mod config;
mod crawler;
mod db;
mod processors;
mod rollup;

use anyhow::Result;
use carbon_core::pipeline::{Pipeline, ShutdownStrategy};
use carbon_nebulous_world_decoder::NebulousWorldDecoder;
use carbon_rpc_program_subscribe_datasource::{Filters as ProgramFilters, RpcProgramSubscribe};
use config::Config;
use processors::account::AccountProcessor;
use solana_account_decoder_client_types::UiAccountEncoding;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};

/// Indexes the nebulous_world Anchor program with Carbon
/// (https://github.com/sevenlabs-hq/carbon): the current state of every
/// account it owns (live via `programSubscribe`, backfilled at startup via
/// `getProgramAccounts`), every instruction sent to it (polled — see
/// src/crawler.rs for why `blockSubscribe` isn't used), and periodic
/// rollups of that data for visualization. Runs as a private Render
/// background service — no public HTTP surface, just this long-running
/// process plus the Postgres database it writes to (see render.yaml).
#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let config = Config::from_env()?;
    log::info!(
        "starting indexer for program {} (rpc: {}, ws: {})",
        config.program_id,
        config.rpc_http_url,
        config.rpc_ws_url
    );

    let pool = db::connect(&config.database_url).await?;

    backfill::run(&config.rpc_http_url, config.program_id, &pool).await?;

    tokio::spawn(rollup::run(pool.clone(), config.rollup_interval_secs));
    tokio::spawn(crawler::run(
        config.rpc_http_url.clone(),
        config.program_id,
        pool.clone(),
        config.crawler_poll_interval_secs,
    ));

    // Without an explicit encoding, programSubscribe defaults to one with a
    // small data-size limit that every account here exceeds (AppAccount's
    // variable-length app_id alone pushes it past that) — the WS stream
    // would silently fail to decode any real update. Base64 has no such
    // limit.
    let account_datasource = RpcProgramSubscribe::new(
        config.rpc_ws_url.clone(),
        ProgramFilters::new(
            config.program_id,
            Some(RpcProgramAccountsConfig {
                filters: None,
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    ..RpcAccountInfoConfig::default()
                },
                with_context: None,
                sort_results: None,
            }),
        ),
    );

    Pipeline::builder()
        .datasource(account_datasource)
        .account(NebulousWorldDecoder, AccountProcessor { pool })
        .shutdown_strategy(ShutdownStrategy::ProcessPending)
        .build()?
        .run()
        .await?;

    Ok(())
}
