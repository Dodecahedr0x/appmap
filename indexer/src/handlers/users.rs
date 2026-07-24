//! Ports `prisma.user.upsert`/`prisma.user.findUnique` call sites: `app/src/
//! app/api/auth/connect`, `app/src/app/api/auth/me`, and `requireUser()` in
//! `app/src/lib/api.ts`. Session tokens themselves stay Node-side (HMAC-signed
//! cookie, no DB round-trip to verify — see `app/src/lib/session.ts`); this
//! is only the User-row lookup/creation those routes need around it.

use crate::api::{not_found, ApiError, ApiState};
use axum::extract::{Json, Path, State};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: String,
    pub wallet: String,
    pub handle: Option<String>,
}

/// Same `id = wallet` convention as `indexer/src/processors/product.rs`'s
/// private helper of the same shape (kept separate: that one runs from the
/// crawler with an `anyhow` error type, this one from an HTTP handler with
/// `ApiError` — not worth unifying the error types just to share ~10 lines).
pub async fn upsert_user_by_wallet(pool: &PgPool, wallet: &str) -> Result<UserDto, ApiError> {
    let row: (String, String, Option<String>) = sqlx::query_as(
        r#"
        INSERT INTO "User" (id, wallet, "createdAt", "updatedAt")
        VALUES ($1, $1, now(), now())
        ON CONFLICT (wallet) DO UPDATE SET wallet = EXCLUDED.wallet
        RETURNING id, wallet, handle
        "#,
    )
    .bind(wallet)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;
    Ok(UserDto { id: row.0, wallet: row.1, handle: row.2 })
}

pub async fn get_user_by_id(pool: &PgPool, id: &str) -> Result<Option<UserDto>, ApiError> {
    let row: Option<(String, String, Option<String>)> =
        sqlx::query_as(r#"SELECT id, wallet, handle FROM "User" WHERE id = $1"#)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(crate::api::internal)?;
    Ok(row.map(|(id, wallet, handle)| UserDto { id, wallet, handle }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectReq {
    wallet: String,
}

async fn connect(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<ConnectReq>,
) -> Result<Json<UserDto>, ApiError> {
    let user = upsert_user_by_wallet(&state.pool, &req.wallet).await?;
    Ok(Json(user))
}

async fn get_by_id(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<UserDto>, ApiError> {
    let user = get_user_by_id(&state.pool, &id)
        .await?
        .ok_or_else(|| not_found("user not found"))?;
    Ok(Json(user))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MyPositionDto {
    kind: &'static str, // "vote" | "tagStake"
    id: String,
    amount: f64,
    app_id: String,
    app_slug: String,
    app_name: String,
    tag_slug: Option<String>,
    tag_name: Option<String>,
}

/// Every active `Vote`/`Stake` row across every app for `id`, the flat list
/// that backs the profile page's "My stakes" panel (see AppMap issue: it was
/// previously only possible to withdraw a stake from the exact app/tag page
/// it was placed on — this is the cross-app view + withdraw button lives on
/// instead). Postgres-only, same as `stakes::list`/`votes::get_vote` — no
/// on-chain read needed since `active`/`amount` here already track a
/// confirmed withdraw.
async fn get_positions(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let votes: Vec<(String, f64, String, String, String)> = sqlx::query_as(
        r#"
        SELECT v.id, v.amount, a.id, a.slug, a.name
        FROM "Vote" v JOIN "App" a ON a.id = v."appId"
        WHERE v."userId" = $1 AND v.active = true
        ORDER BY v.amount DESC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let stakes: Vec<(String, f64, String, String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT s.id, s.amount, a.id, a.slug, a.name, t.slug, t.name
        FROM "Stake" s
        JOIN "AppTag" at ON at.id = s."appTagId"
        JOIN "App" a ON a.id = at."appId"
        JOIN "Tag" t ON t.id = at."tagId"
        WHERE s."userId" = $1 AND s.active = true
        ORDER BY s.amount DESC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let mut positions: Vec<MyPositionDto> = votes
        .into_iter()
        .map(|(vid, amount, app_id, app_slug, app_name)| MyPositionDto {
            kind: "vote",
            id: vid,
            amount,
            app_id,
            app_slug,
            app_name,
            tag_slug: None,
            tag_name: None,
        })
        .collect();
    positions.extend(stakes.into_iter().map(
        |(sid, amount, app_id, app_slug, app_name, tag_slug, tag_name)| MyPositionDto {
            kind: "tagStake",
            id: sid,
            amount,
            app_id,
            app_slug,
            app_name,
            tag_slug: Some(tag_slug),
            tag_name: Some(tag_name),
        },
    ));
    positions.sort_by(|a, b| b.amount.partial_cmp(&a.amount).unwrap_or(std::cmp::Ordering::Equal));

    Ok(Json(serde_json::json!({ "positions": positions })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/users/connect", post(connect))
        .route("/users/:id", get(get_by_id))
        .route("/users/:id/positions", get(get_positions))
}
