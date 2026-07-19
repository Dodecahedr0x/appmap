//! Reconciles the product tables (`App`/`Tag`/`AppTag`, see
//! `migrations/005_app_schema.sql`) and the raw `indexed_account` mirror
//! against the live on-chain account snapshot `backfill::run` takes at every
//! startup — the two things that can drift between restarts:
//!
//! - **Existence**: `App`/`Tag` rows for accounts closed on-chain (there is
//!   no `close` instruction for either today, see `AppAccount`'s doc
//!   comment, but a future program upgrade or a manually-reset local
//!   database can still produce this) get removed, cascading to their
//!   `AppTag`/`Vote`/`Stake`/... rows via the FKs in
//!   `005_app_schema.sql`. On-chain accounts with no matching row (a
//!   database reset, or a memo the crawler failed to parse — see
//!   `processors/product.rs`) get a placeholder row so they're at least
//!   discoverable; `crawler.rs` fills in real metadata once it replays that
//!   app's `init_app`/`suggest_tag` instruction.
//! - **Stake**: `App.voteWeight`/`stakeTotal` and `AppTag.stakeTotal` are
//!   normally derived by `handlers::engine::refresh_app`/`refresh_app_tag`
//!   from the off-chain `Vote`/`Stake` ledger tables — populated by
//!   `handlers/votes.rs`/`stakes.rs`, which trust whatever amount the
//!   client claims in its POST body (only a `txSig` presence check, no
//!   verification the amount matches what that transaction actually moved).
//!   This pass overwrites those cached totals with the real on-chain
//!   aggregates (`AppAccount.total_vote_stake`/`total_tag_stake`,
//!   `AppTagStake.stake_amount`) instead, the only place anything in this
//!   codebase checks the client-reported ledger against reality.
//!
//! Runs once at startup, after `backfill::run` and before the crawler
//! starts concurrently writing to the same tables (see `main.rs`).

use crate::handlers::engine::{age_in_days, compute_rank_score, RankInputs};
use anyhow::Result;
use carbon_nebulous_world_decoder::accounts::app_account::AppAccount;
use carbon_nebulous_world_decoder::accounts::app_tag_stake::AppTagStake;
use carbon_nebulous_world_decoder::accounts::NebulousWorldAccount;
use chrono::{NaiveDateTime, Utc};
use solana_pubkey::Pubkey;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

pub async fn run(pool: &PgPool, accounts: &[(Pubkey, NebulousWorldAccount)], vote_token_decimals: u32) -> Result<()> {
    let scale = 10f64.powi(vote_token_decimals as i32);

    let mut on_chain_apps: HashMap<String, &AppAccount> = HashMap::new();
    let mut app_id_by_pda: HashMap<Pubkey, String> = HashMap::new();
    let mut on_chain_tag_ids: HashSet<String> = HashSet::new();
    let mut tag_id_by_pda: HashMap<Pubkey, String> = HashMap::new();
    let mut on_chain_stakes = Vec::new();
    let mut seen_pubkeys: Vec<String> = Vec::new();

    for (pubkey, decoded) in accounts {
        match decoded {
            NebulousWorldAccount::AppAccount(app) => {
                app_id_by_pda.insert(*pubkey, app.app_id.clone());
                on_chain_apps.insert(app.app_id.clone(), app.as_ref());
                seen_pubkeys.push(pubkey.to_string());
            }
            NebulousWorldAccount::Tag(tag) => {
                tag_id_by_pda.insert(*pubkey, tag.tag_id.clone());
                on_chain_tag_ids.insert(tag.tag_id.clone());
                seen_pubkeys.push(pubkey.to_string());
            }
            NebulousWorldAccount::AppTagStake(stake) => {
                on_chain_stakes.push(stake.as_ref());
                seen_pubkeys.push(pubkey.to_string());
            }
            _ => {}
        }
    }

    let (apps_removed, apps_added) = reconcile_apps(pool, &on_chain_apps).await?;
    let (tags_removed, tags_added) = reconcile_tags(pool, &on_chain_tag_ids).await?;
    reconcile_stakes(pool, &on_chain_stakes, &app_id_by_pda, &tag_id_by_pda, scale).await?;
    refresh_app_totals(pool, &on_chain_apps, scale).await?;
    let stale_mirrored = prune_indexed_account(pool, &seen_pubkeys).await?;

    log::info!(
        "reconcile: apps +{apps_added}/-{apps_removed}, tags +{tags_added}/-{tags_removed}, \
         {} indexed_account row(s) pruned",
        stale_mirrored
    );
    Ok(())
}

async fn reconcile_apps(pool: &PgPool, on_chain: &HashMap<String, &AppAccount>) -> Result<(usize, usize)> {
    let db_ids: Vec<String> = sqlx::query_scalar(r#"SELECT id FROM "App""#).fetch_all(pool).await?;
    let db_set: HashSet<&str> = db_ids.iter().map(String::as_str).collect();
    let on_chain_set: HashSet<&str> = on_chain.keys().map(String::as_str).collect();

    let stale: Vec<String> = db_set.difference(&on_chain_set).map(|s| s.to_string()).collect();
    if !stale.is_empty() {
        sqlx::query(r#"DELETE FROM "App" WHERE id = ANY($1)"#)
            .bind(stale.as_slice())
            .execute(pool)
            .await?;
        log::warn!("reconcile: removed App row(s) with no on-chain account: {stale:?}");
    }

    let missing: Vec<&str> = on_chain_set.difference(&db_set).copied().collect();
    for app_id in &missing {
        let app = on_chain[*app_id];
        let url = format!("https://{}", app.url);
        sqlx::query(
            r#"
            INSERT INTO "App" (id, slug, name, url, "updatedAt")
            VALUES ($1, $1, $1, $2, now())
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(app_id)
        .bind(&url)
        .execute(pool)
        .await?;
    }
    if !missing.is_empty() {
        log::warn!(
            "reconcile: added placeholder App row(s) for on-chain app(s) missing from the \
             database (crawler will backfill real metadata): {missing:?}"
        );
    }

    Ok((stale.len(), missing.len()))
}

async fn reconcile_tags(pool: &PgPool, on_chain: &HashSet<String>) -> Result<(usize, usize)> {
    let db_ids: Vec<String> = sqlx::query_scalar(r#"SELECT id FROM "Tag""#).fetch_all(pool).await?;
    let db_set: HashSet<&str> = db_ids.iter().map(String::as_str).collect();
    let on_chain_set: HashSet<&str> = on_chain.iter().map(String::as_str).collect();

    let stale: Vec<String> = db_set.difference(&on_chain_set).map(|s| s.to_string()).collect();
    if !stale.is_empty() {
        sqlx::query(r#"DELETE FROM "Tag" WHERE id = ANY($1)"#)
            .bind(stale.as_slice())
            .execute(pool)
            .await?;
        log::warn!("reconcile: removed Tag row(s) with no on-chain account: {stale:?}");
    }

    let missing: Vec<&str> = on_chain_set.difference(&db_set).copied().collect();
    for tag_id in &missing {
        sqlx::query(
            r#"
            INSERT INTO "Tag" (id, slug, name)
            VALUES ($1, $1, $1)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(tag_id)
        .execute(pool)
        .await?;
    }
    if !missing.is_empty() {
        log::warn!("reconcile: added placeholder Tag row(s) for on-chain tag(s) missing from the database: {missing:?}");
    }

    Ok((stale.len(), missing.len()))
}

/// Overwrites `AppTag.stakeTotal` with the real on-chain `AppTagStake.
/// stake_amount` for every (app, tag) pair that has one, adding a minimal
/// `AppTag` row if the stake account exists but the link row doesn't (can
/// only happen if the database was reset independently of the chain), and
/// zeroing any `AppTag.stakeTotal` that has no backing on-chain stake
/// account at all — `stake_tag` always creates one, so its absence means
/// nothing is actually staked regardless of what the off-chain ledger
/// claims. Must run after `reconcile_apps`/`reconcile_tags` so the FK
/// targets it inserts against already exist.
async fn reconcile_stakes(
    pool: &PgPool,
    on_chain_stakes: &[&AppTagStake],
    app_id_by_pda: &HashMap<Pubkey, String>,
    tag_id_by_pda: &HashMap<Pubkey, String>,
    scale: f64,
) -> Result<()> {
    let mut backed_app_tag_ids: HashSet<String> = HashSet::new();

    for stake in on_chain_stakes {
        let (Some(app_id), Some(tag_id)) = (app_id_by_pda.get(&stake.app), tag_id_by_pda.get(&stake.tag)) else {
            log::warn!(
                "reconcile: AppTagStake references app {} / tag {} with no matching on-chain account, skipping",
                stake.app, stake.tag
            );
            continue;
        };
        let app_tag_id = format!("{app_id}_{tag_id}");
        let stake_total = stake.stake_amount as f64 / scale;

        sqlx::query(
            r#"
            INSERT INTO "AppTag" (id, "appId", "tagId", "stakeTotal")
            VALUES ($1, $2, $3, $4)
            ON CONFLICT ("appId", "tagId") DO UPDATE SET "stakeTotal" = EXCLUDED."stakeTotal"
            "#,
        )
        .bind(&app_tag_id)
        .bind(app_id)
        .bind(tag_id)
        .bind(stake_total)
        .execute(pool)
        .await?;
        backed_app_tag_ids.insert(app_tag_id);
    }

    let backed: Vec<String> = backed_app_tag_ids.into_iter().collect();
    let unbacked: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "AppTag" WHERE "stakeTotal" != 0 AND NOT (id = ANY($1))"#,
    )
    .bind(backed.as_slice())
    .fetch_all(pool)
    .await?;
    for (id,) in &unbacked {
        sqlx::query(r#"UPDATE "AppTag" SET "stakeTotal" = 0 WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if !unbacked.is_empty() {
        log::warn!(
            "reconcile: zeroed stakeTotal for {} AppTag row(s) with no backing on-chain AppTagStake account",
            unbacked.len()
        );
    }

    Ok(())
}

/// Overwrites each surviving `App`'s `voteWeight`/`stakeTotal` with the
/// on-chain `AppAccount.total_vote_stake`/`total_tag_stake` aggregates and
/// recomputes `rankScore` to match (same formula as
/// `handlers::engine::refresh_app`) — `voteCount`/`viewCount` have no
/// on-chain equivalent and are left untouched.
async fn refresh_app_totals(pool: &PgPool, on_chain: &HashMap<String, &AppAccount>, scale: f64) -> Result<()> {
    for (app_id, app) in on_chain {
        let row: Option<(NaiveDateTime, i32)> =
            sqlx::query_as(r#"SELECT "createdAt", "viewCount" FROM "App" WHERE id = $1"#)
                .bind(app_id)
                .fetch_optional(pool)
                .await?;
        let Some((created_at, view_count)) = row else {
            continue;
        };

        let vote_weight = app.total_vote_stake as f64 / scale;
        let stake_total = app.total_tag_stake as f64 / scale;
        let rank_score = compute_rank_score(&RankInputs {
            vote_weight,
            stake_total,
            view_count: view_count as f64,
            age_days: age_in_days(created_at, Utc::now().naive_utc()),
        });

        sqlx::query(
            r#"
            UPDATE "App"
            SET "voteWeight" = $2, "stakeTotal" = $3, "rankScore" = $4, "updatedAt" = now()
            WHERE id = $1
            "#,
        )
        .bind(app_id)
        .bind(vote_weight)
        .bind(stake_total)
        .bind(rank_score)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Prunes `indexed_account` rows of the App/Tag/AppTagStake types that
/// backfill's `getProgramAccounts` scan didn't see this time — unlike the
/// live `programSubscribe` pipeline, a plain upsert (backfill's own
/// `index_account` calls) never removes a row for an account that no
/// longer matches the scan, so a closed account's mirror row would
/// otherwise sit here forever (see `processors/account.rs`'s
/// `delete_account` doc comment for the equivalent, narrower problem it
/// solves for `VotePosition`/`StakePosition`).
async fn prune_indexed_account(pool: &PgPool, seen_pubkeys: &[String]) -> Result<u64> {
    let result = sqlx::query(
        r#"
        DELETE FROM indexed_account
        WHERE account_type IN ('AppAccount', 'Tag', 'AppTagStake')
          AND NOT (pubkey = ANY($1))
        "#,
    )
    .bind(seen_pubkeys)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
