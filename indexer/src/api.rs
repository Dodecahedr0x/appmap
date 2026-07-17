//! HTTP API the Next.js app talks to instead of a Solana RPC endpoint —
//! the whole point of this module: the app should never construct its own
//! `Connection`/RPC client, it should "rely entirely on the indexer" (see
//! the architecture note at the top of README.md). Every account read here
//! comes from `indexed_account` (already decoded by the Carbon pipeline —
//! no RPC call per request); every `/tx/*` endpoint builds an unsigned
//! transaction from that same indexed data plus a fresh blockhash (the one
//! RPC call this API does make, unavoidable since a transaction needs a
//! *current* blockhash); `/tx/submit` relays an already wallet-signed
//! transaction to the network. DLMM (Meteora) pool status/swap-building is
//! proxied to the `dlmm-bridge` sidecar (see dlmm-bridge/README.md for why
//! that one piece isn't native Rust).
//!
//! Internal-only (see render.yaml's `pserv` — no public HTTP surface):
//! the Next.js app's own API routes call this, the browser never does.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;
use sqlx::types::Json as SqlxJson;
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;

use nebulous_world::constants::{
    APP_SEED, APP_TAG_STAKE_SEED, CONFIG_SEED, STAKE_POSITION_SEED, TAG_SEED, VOTE_POSITION_SEED,
};

const TOKEN_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("11111111111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Anchor instruction discriminators — copied verbatim from the matching
// `decode()` methods in decoder/src/instructions/*.rs (generated from the
// real on-chain IDL), so they're guaranteed correct without re-deriving
// sighash("global:<name>") by hand here.
const VOTE_DISC: [u8; 8] = [227, 110, 155, 23, 136, 126, 172, 25];
const WITHDRAW_VOTE_DISC: [u8; 8] = [243, 255, 70, 200, 3, 242, 103, 137];
const STAKE_TAG_DISC: [u8; 8] = [28, 227, 157, 227, 87, 132, 122, 89];
const WITHDRAW_TAG_STAKE_DISC: [u8; 8] = [56, 134, 3, 156, 20, 123, 219, 197];
const CLAIM_VOTE_REWARD_DISC: [u8; 8] = [113, 18, 86, 93, 183, 183, 117, 245];
const CLAIM_TAG_REWARD_DISC: [u8; 8] = [90, 104, 233, 219, 216, 183, 0, 2];

pub struct ApiState {
    pub pool: PgPool,
    pub rpc: RpcClient,
    pub http: reqwest::Client,
    pub program_id: Pubkey,
    pub vote_token_mint: Pubkey,
    /// Base URL of the dlmm-bridge sidecar (e.g. http://127.0.0.1:8091) —
    /// see dlmm-bridge/README.md for why DLMM pool reads/swap-building are
    /// proxied there instead of implemented natively in Rust.
    pub dlmm_bridge_url: String,
}

pub fn router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/accounts/app/:app_id", get(get_app_account))
        .route(
            "/accounts/app-tag/:app_id/:tag_slug",
            get(get_app_tag_account),
        )
        .route(
            "/accounts/vote-position/:app_id/:owner",
            get(get_vote_position),
        )
        .route(
            "/accounts/stake-position/:app_id/:tag_slug/:owner",
            get(get_stake_position),
        )
        .route("/balances/:owner/:mint", get(get_balance))
        .route("/pool", get(get_pool))
        .route("/tx/vote", post(build_vote))
        .route("/tx/withdraw-vote", post(build_withdraw_vote))
        .route("/tx/stake-tag", post(build_stake_tag))
        .route("/tx/withdraw-tag-stake", post(build_withdraw_tag_stake))
        .route("/tx/claim-vote-reward", post(build_claim_vote_reward))
        .route("/tx/claim-tag-reward", post(build_claim_tag_reward))
        .route("/tx/buy-neb/build", post(build_buy_neb))
        .route("/tx/submit", post(submit_tx))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn not_found(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, msg.into())
}

fn internal(msg: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, msg.to_string())
}

fn parse_pubkey(field: &str, s: &str) -> Result<Pubkey, ApiError> {
    Pubkey::from_str(s).map_err(|_| bad_request(format!("invalid pubkey for {field}: {s}")))
}

fn parse_u64(field: &str, s: &str) -> Result<u64, ApiError> {
    s.parse::<u64>()
        .map_err(|_| bad_request(format!("invalid u64 for {field}: {s}")))
}

// ---------------------------------------------------------------------
// PDA derivation — mirrors app/src/lib/anchorClient.ts exactly (same
// seeds, same order). Pure crypto, no RPC/DB involved.
// ---------------------------------------------------------------------

fn config_pda(program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id).0
}

fn app_pda(program_id: &Pubkey, app_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], program_id).0
}

fn vote_position_pda(program_id: &Pubkey, app: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[VOTE_POSITION_SEED, app.as_ref(), user.as_ref()],
        program_id,
    )
    .0
}

/// The GLOBAL tag identity — seeded only by the tag string, no `app`. The
/// same tag_id always derives the same `Tag` PDA no matter which app
/// suggested it.
fn tag_pda(program_id: &Pubkey, tag_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[TAG_SEED, tag_id.as_bytes()], program_id).0
}

/// The stake-accounting connection for one (app, tag) pair — replaces the
/// old single `AppTagAccount` PDA now that tags are global (see `tag_pda`).
fn app_tag_stake_pda(program_id: &Pubkey, app: &Pubkey, tag: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[APP_TAG_STAKE_SEED, app.as_ref(), tag.as_ref()],
        program_id,
    )
    .0
}

fn stake_position_pda(program_id: &Pubkey, app_tag_stake: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, app_tag_stake.as_ref(), user.as_ref()],
        program_id,
    )
    .0
}

fn associated_token_address(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// The single global vault every instruction transfers through — an ATA
/// owned by the `config` PDA (see programs/nebulous_world/src/state/config.rs).
fn vault_address(config: &Pubkey, mint: &Pubkey) -> Pubkey {
    associated_token_address(config, mint)
}

// ---------------------------------------------------------------------
// Account reads — straight from `indexed_account`'s JSONB, deserialized
// directly into a concrete struct (never into a generic serde_json::Value)
// so u64/u128 fields keep full precision — see the module doc on
// AppAccountRow for why this matters.
// ---------------------------------------------------------------------

/// Mirrors decoder/src/accounts/app_account.rs field-for-field (same
/// names, since that struct has no #[serde(rename)] — its JSON keys are
/// its Rust field names verbatim). Deserializing straight into typed u64/
/// u128 fields (rather than through a generic serde_json::Value, whose
/// Number type can't hold u128 and silently loses precision above 2^64)
/// is what keeps `vote_acc_reward_per_share`/`tags_acc_reward_per_share`
/// exact.
#[derive(Deserialize)]
struct AppAccountRow {
    app_id: String,
    total_vote_stake: u64,
    vote_acc_reward_per_share: u128,
    total_tag_stake: u64,
    tags_acc_reward_per_share: u128,
    bump: u8,
}

#[derive(Deserialize)]
struct AppTagStakeRow {
    app: Pubkey,
    tag: Pubkey,
    stake_amount: u64,
    bump: u8,
}

#[derive(Deserialize)]
struct PositionRow {
    owner: Pubkey,
    amount: u64,
    reward_debt: u128,
    bump: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppAccountDto {
    pda: String,
    app_id: String,
    total_vote_stake: String,
    vote_acc_reward_per_share: String,
    total_tag_stake: String,
    tags_acc_reward_per_share: String,
    bump: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppTagStakeDto {
    pda: String,
    app: String,
    tag: String,
    /// Not read off the account (it no longer stores this — the tag_id
    /// string lives on the separate global `Tag` account instead): this is
    /// simply the `tag_slug` path param, which is exactly the string that
    /// derived `tag` above.
    tag_id: String,
    stake_amount: String,
    bump: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionDto {
    pda: String,
    owner: String,
    amount: String,
    reward_debt: String,
    bump: u8,
}

/// Fetches one row's `data` JSONB column, deserialized into `T`, or `Ok(None)`
/// if no row exists for that pubkey/account_type pair — a 404 to callers,
/// not an error, since e.g. a VotePosition legitimately doesn't exist until
/// a user's first vote.
async fn fetch_account<T: serde::de::DeserializeOwned + Send + Unpin + 'static>(
    pool: &PgPool,
    pubkey: &Pubkey,
    account_type: &str,
) -> Result<Option<T>, ApiError> {
    let row: Option<(SqlxJson<T>,)> = sqlx::query_as(
        // `data` is `{"type": "<AccountType>", "data": {...fields}}` — the
        // Codama-generated `NebulousWorldAccount` enum's serde-tagged
        // representation (see decoder/src/accounts/mod.rs). `->'data'`
        // unwraps straight to the fields, which the account_type column
        // (checked below) already disambiguates without needing the tag.
        "SELECT data->'data' FROM indexed_account WHERE pubkey = $1 AND account_type = $2",
    )
    .bind(pubkey.to_string())
    .bind(account_type)
    .fetch_optional(pool)
    .await
    .map_err(internal)?;
    Ok(row.map(|(SqlxJson(v),)| v))
}

async fn get_app_account(
    State(state): State<Arc<ApiState>>,
    Path(app_id): Path<String>,
) -> Result<Json<AppAccountDto>, ApiError> {
    let pda = app_pda(&state.program_id, &app_id);
    let row: AppAccountRow = fetch_account(&state.pool, &pda, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {app_id} is not indexed yet")))?;
    Ok(Json(AppAccountDto {
        pda: pda.to_string(),
        app_id: row.app_id,
        total_vote_stake: row.total_vote_stake.to_string(),
        vote_acc_reward_per_share: row.vote_acc_reward_per_share.to_string(),
        total_tag_stake: row.total_tag_stake.to_string(),
        tags_acc_reward_per_share: row.tags_acc_reward_per_share.to_string(),
        bump: row.bump,
    }))
}

async fn get_app_tag_account(
    State(state): State<Arc<ApiState>>,
    Path((app_id, tag_slug)): Path<(String, String)>,
) -> Result<Json<AppTagStakeDto>, ApiError> {
    let app = app_pda(&state.program_id, &app_id);
    let tag = tag_pda(&state.program_id, &tag_slug);
    let pda = app_tag_stake_pda(&state.program_id, &app, &tag);
    let row: AppTagStakeRow = fetch_account(&state.pool, &pda, "AppTagStake")
        .await?
        .ok_or_else(|| not_found(format!("tag {tag_slug} on app {app_id} is not indexed yet")))?;
    Ok(Json(AppTagStakeDto {
        pda: pda.to_string(),
        app: row.app.to_string(),
        tag: row.tag.to_string(),
        tag_id: tag_slug,
        stake_amount: row.stake_amount.to_string(),
        bump: row.bump,
    }))
}

async fn get_vote_position(
    State(state): State<Arc<ApiState>>,
    Path((app_id, owner)): Path<(String, String)>,
) -> Result<Json<PositionDto>, ApiError> {
    let owner_pk = parse_pubkey("owner", &owner)?;
    let app = app_pda(&state.program_id, &app_id);
    let pda = vote_position_pda(&state.program_id, &app, &owner_pk);
    let row: PositionRow = fetch_account(&state.pool, &pda, "VotePosition")
        .await?
        .ok_or_else(|| not_found("no vote position yet".to_string()))?;
    Ok(Json(PositionDto {
        pda: pda.to_string(),
        owner: row.owner.to_string(),
        amount: row.amount.to_string(),
        reward_debt: row.reward_debt.to_string(),
        bump: row.bump,
    }))
}

async fn get_stake_position(
    State(state): State<Arc<ApiState>>,
    Path((app_id, tag_slug, owner)): Path<(String, String, String)>,
) -> Result<Json<PositionDto>, ApiError> {
    let owner_pk = parse_pubkey("owner", &owner)?;
    let app = app_pda(&state.program_id, &app_id);
    let tag = tag_pda(&state.program_id, &tag_slug);
    let app_tag_stake = app_tag_stake_pda(&state.program_id, &app, &tag);
    let pda = stake_position_pda(&state.program_id, &app_tag_stake, &owner_pk);
    let row: PositionRow = fetch_account(&state.pool, &pda, "StakePosition")
        .await?
        .ok_or_else(|| not_found("no stake position yet".to_string()))?;
    Ok(Json(PositionDto {
        pda: pda.to_string(),
        owner: row.owner.to_string(),
        amount: row.amount.to_string(),
        reward_debt: row.reward_debt.to_string(),
        bump: row.bump,
    }))
}

// ---------------------------------------------------------------------
// Wallet token balances — a single targeted `getTokenAccountBalance` per
// request, not a `getProgramAccounts` scan, so this doesn't fall under the
// "getProgramAccounts only at startup" constraint (that's about the one
// RPC method that scans every account owned by a program — a per-owner
// balance lookup is a normal, cheap, targeted read). Runs indexer-side so
// the app itself never touches RPC.
// ---------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BalanceDto {
    amount: String,
    decimals: u8,
    ui_amount_string: String,
}

async fn get_balance(
    State(state): State<Arc<ApiState>>,
    Path((owner, mint)): Path<(String, String)>,
) -> Result<Json<BalanceDto>, ApiError> {
    let owner_pk = parse_pubkey("owner", &owner)?;
    let mint_pk = parse_pubkey("mint", &mint)?;
    let ata = associated_token_address(&owner_pk, &mint_pk);
    match state.rpc.get_token_account_balance(&ata).await {
        Ok(balance) => Ok(Json(BalanceDto {
            amount: balance.amount,
            decimals: balance.decimals,
            ui_amount_string: balance.ui_amount_string,
        })),
        // No ATA yet (wallet never held this token) — a zero balance, not
        // an error, mirroring useWalletBalances.ts's prior client-side
        // try/catch-to-zero behavior.
        Err(_) => Ok(Json(BalanceDto {
            amount: "0".to_string(),
            decimals: 0,
            ui_amount_string: "0".to_string(),
        })),
    }
}

// ---------------------------------------------------------------------
// DLMM pool status / swap building — proxied to the sidecar.
// ---------------------------------------------------------------------

async fn get_pool(State(state): State<Arc<ApiState>>) -> Result<Response, ApiError> {
    proxy_get(&state, "/pool").await
}

async fn build_buy_neb(
    State(state): State<Arc<ApiState>>,
    body: Json<serde_json::Value>,
) -> Result<Response, ApiError> {
    proxy_post(&state, "/tx/buy-neb/build", body.0).await
}

async fn proxy_get(state: &Arc<ApiState>, path: &str) -> Result<Response, ApiError> {
    let url = format!("{}{}", state.dlmm_bridge_url, path);
    let resp = state.http.get(&url).send().await.map_err(internal)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let body = resp.text().await.map_err(internal)?;
    Ok((status, [("content-type", "application/json")], body).into_response())
}

async fn proxy_post(
    state: &Arc<ApiState>,
    path: &str,
    body: serde_json::Value,
) -> Result<Response, ApiError> {
    let url = format!("{}{}", state.dlmm_bridge_url, path);
    let resp = state
        .http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(internal)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let text = resp.text().await.map_err(internal)?;
    Ok((status, [("content-type", "application/json")], text).into_response())
}

// ---------------------------------------------------------------------
// Transaction building — raw instruction construction (discriminator +
// borsh-encoded args, both copied from the generated decoder) rather than
// pulling in anchor-client. `nebulous_world` is still a Cargo path
// dependency (see Cargo.toml) — but only for its `constants` module (PDA
// seed bytes), never as an Anchor CPI/client crate. Account order and
// is_signer/is_writable flags mirror programs/nebulous_world/src/
// instructions/*.rs's `#[derive(Accounts)]` structs exactly.
// ---------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuiltTxDto {
    transaction: String,
}

async fn unsigned_tx_base64(
    rpc: &RpcClient,
    fee_payer: &Pubkey,
    instruction: Instruction,
) -> Result<String, ApiError> {
    let blockhash: Hash = rpc.get_latest_blockhash().await.map_err(internal)?;
    let message = Message::new_with_blockhash(&[instruction], Some(fee_payer), &blockhash);
    let tx = Transaction::new_unsigned(message);
    let bytes = bincode::serialize(&tx).map_err(internal)?;
    Ok(BASE64.encode(bytes))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoteReq {
    app_id: String,
    amount: String,
    user: String,
}

async fn build_vote(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<VoteReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let amount = parse_u64("amount", &req.amount)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let position = vote_position_pda(&state.program_id, &app, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let mut data = VOTE_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(app, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

async fn build_withdraw_vote(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<VoteReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let amount = parse_u64("amount", &req.amount)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let position = vote_position_pda(&state.program_id, &app, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let mut data = WITHDRAW_VOTE_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    // No system_program — WithdrawVote never inits an account (unlike Vote's
    // init_if_needed position). `user` is a signer but not writable — this
    // instruction never debits/credits the fee payer's own lamports balance
    // beyond the network fee (which doesn't require is_writable on the
    // signer field itself).
    let accounts = vec![
        AccountMeta::new(app, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new_readonly(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StakeTagReq {
    app_id: String,
    tag_slug: String,
    amount: String,
    user: String,
}

async fn build_stake_tag(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<StakeTagReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let amount = parse_u64("amount", &req.amount)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let tag = tag_pda(&state.program_id, &req.tag_slug);
    let app_tag_stake = app_tag_stake_pda(&state.program_id, &app, &tag);
    let position = stake_position_pda(&state.program_id, &app_tag_stake, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    let _app_tag_stake_row: AppTagStakeRow =
        fetch_account(&state.pool, &app_tag_stake, "AppTagStake")
            .await?
            .ok_or_else(|| not_found(format!("tag {} is not indexed yet", req.tag_slug)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let mut data = STAKE_TAG_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(app, false),
        AccountMeta::new(app_tag_stake, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

async fn build_withdraw_tag_stake(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<StakeTagReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let amount = parse_u64("amount", &req.amount)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let tag = tag_pda(&state.program_id, &req.tag_slug);
    let app_tag_stake = app_tag_stake_pda(&state.program_id, &app, &tag);
    let position = stake_position_pda(&state.program_id, &app_tag_stake, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    let _app_tag_stake_row: AppTagStakeRow =
        fetch_account(&state.pool, &app_tag_stake, "AppTagStake")
            .await?
            .ok_or_else(|| not_found(format!("tag {} is not indexed yet", req.tag_slug)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let mut data = WITHDRAW_TAG_STAKE_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(app, false),
        AccountMeta::new(app_tag_stake, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new_readonly(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimVoteReq {
    app_id: String,
    user: String,
}

async fn build_claim_vote_reward(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<ClaimVoteReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let position = vote_position_pda(&state.program_id, &app, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let data = CLAIM_VOTE_REWARD_DISC.to_vec();

    // `app` is read-only here (never mutated by claim_vote_reward — see
    // that handler's doc comment on ClaimVoteReward::app).
    let accounts = vec![
        AccountMeta::new_readonly(app, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new_readonly(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimTagReq {
    app_id: String,
    tag_slug: String,
    user: String,
}

async fn build_claim_tag_reward(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<ClaimTagReq>,
) -> Result<Json<BuiltTxDto>, ApiError> {
    let user = parse_pubkey("user", &req.user)?;
    let app = app_pda(&state.program_id, &req.app_id);
    let tag = tag_pda(&state.program_id, &req.tag_slug);
    let app_tag_stake = app_tag_stake_pda(&state.program_id, &app, &tag);
    let position = stake_position_pda(&state.program_id, &app_tag_stake, &user);
    let _app_row: AppAccountRow = fetch_account(&state.pool, &app, "AppAccount")
        .await?
        .ok_or_else(|| not_found(format!("app {} is not indexed yet", req.app_id)))?;
    // app_tag_stake only needs to exist for PDA/ownership purposes here —
    // its fields aren't read for account resolution (the vault is derived
    // from `config`, not `app_tag_stake`).
    let _app_tag_stake_row: AppTagStakeRow =
        fetch_account(&state.pool, &app_tag_stake, "AppTagStake")
            .await?
            .ok_or_else(|| not_found(format!("tag {} is not indexed yet", req.tag_slug)))?;
    let config = config_pda(&state.program_id);
    let vault = vault_address(&config, &state.vote_token_mint);
    let user_token_account = associated_token_address(&user, &state.vote_token_mint);

    let data = CLAIM_TAG_REWARD_DISC.to_vec();

    // `app` and `app_tag_stake` are both read-only (see ClaimTagReward's doc
    // comments — neither field is ever mutated by this instruction).
    let accounts = vec![
        AccountMeta::new_readonly(app, false),
        AccountMeta::new_readonly(app_tag_stake, false),
        AccountMeta::new(position, false),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new_readonly(user, true),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
    ];
    let ix = Instruction::new_with_bytes(state.program_id, &data, accounts);
    let tx = unsigned_tx_base64(&state.rpc, &user, ix).await?;
    Ok(Json(BuiltTxDto { transaction: tx }))
}

// ---------------------------------------------------------------------
// Submission — the other RPC call this API makes: relaying an
// already-signed transaction (wallet signing happens client-side; the
// indexer never sees a private key). Works for both nebulous_world
// instructions and the DLMM swap built by the sidecar, since submission
// doesn't care about instruction content.
// ---------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitReq {
    signed_transaction: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitDto {
    signature: String,
}

async fn submit_tx(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<SubmitReq>,
) -> Result<Json<SubmitDto>, ApiError> {
    let bytes = BASE64
        .decode(req.signed_transaction)
        .map_err(|e| bad_request(format!("invalid base64: {e}")))?;
    let tx: Transaction =
        bincode::deserialize(&bytes).map_err(|e| bad_request(format!("invalid transaction: {e}")))?;
    let signature = state
        .rpc
        .send_and_confirm_transaction(&tx)
        .await
        .map_err(internal)?;
    Ok(Json(SubmitDto {
        signature: signature.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-checked against app/src/lib/anchorClient.ts's appPda/
    /// votePositionPda/tagPda/appTagStakePda/stakePositionPda for the same
    /// (programId, appId, user, tagSlug) inputs — these two implementations
    /// must derive byte-identical PDAs, since the app signs against
    /// whichever address it independently computes, but only this API's
    /// derivation determines which accounts actually go into the built
    /// instruction.
    #[test]
    fn pda_derivation_matches_the_app_ts_client() {
        let program_id = Pubkey::from_str("7AAwB8aHgmuz9yzYdo6gKjZRx5KkjePYHyuJEmrcRXgX").unwrap();
        let app_id = "test-app-123";
        let user = Pubkey::from_str("5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a").unwrap();
        let tag_slug = "example-tag";

        let config = config_pda(&program_id);
        let app = app_pda(&program_id, app_id);
        let vote_pos = vote_position_pda(&program_id, &app, &user);
        let tag = tag_pda(&program_id, tag_slug);
        let app_tag_stake = app_tag_stake_pda(&program_id, &app, &tag);
        let stake_pos = stake_position_pda(&program_id, &app_tag_stake, &user);

        assert_eq!(config.to_string(), "aSsmFCbhZeCtkk6jaqmtUHALDkBeYWkDVbcrEzsLaa5");
        assert_eq!(app.to_string(), "WFFEeYwFZEwqG6u39gmyeVdQpZZ2saJ1NdumT2ibf54");
        assert_eq!(vote_pos.to_string(), "5HyY7dqWi1xLjijrViq1Xm7dSSBfVFf4EwL26kLHGFL5");
        assert_eq!(tag.to_string(), "EwCP1sFK2Reuu4RiiwvygBffzCt8rEqxKocHFSTSenCF");
        assert_eq!(app_tag_stake.to_string(), "Amrp4xm898tGgeeXZ2zKoj2YEdfoRNF1NSFPw51ivLjR");
        assert_eq!(stake_pos.to_string(), "27N8WYexQynYkqkfP6vjts4ZCAd4KErdDqfEw2t77BcS");
    }
}
