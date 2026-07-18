//! Ports `app/src/app/api/stake/route.ts` + `stake/withdraw/route.ts`. Same
//! trust model as `votes.rs` — see that file's doc comment.

use crate::api::{not_found, ApiError, ApiState};
use crate::handlers::engine::{refresh_app, refresh_app_tag};
use axum::extract::{Json, Path, Query, State};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    app_id: String,
    user_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StakeDto {
    id: String,
    amount: f64,
    app_tag_id: String,
}

async fn list(State(state): State<Arc<ApiState>>, Query(q): Query<ListQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let rows: Vec<(String, f64, String)> = sqlx::query_as(
        r#"
        SELECT s.id, s.amount, s."appTagId"
        FROM "Stake" s JOIN "AppTag" at ON at.id = s."appTagId"
        WHERE s."userId" = $1 AND s.active = true AND at."appId" = $2
        "#,
    )
    .bind(&q.user_id)
    .bind(&q.app_id)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let stakes: Vec<StakeDto> = rows.into_iter().map(|(id, amount, app_tag_id)| StakeDto { id, amount, app_tag_id }).collect();
    Ok(Json(serde_json::json!({ "stakes": stakes })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReq {
    app_tag_id: String,
    user_id: String,
    amount: f64,
    tx_sig: Option<String>,
    simulation_mode: bool,
}

async fn create(State(state): State<Arc<ApiState>>, Json(req): Json<CreateReq>) -> Result<Json<serde_json::Value>, ApiError> {
    let app_id: Option<String> = sqlx::query_scalar(r#"SELECT "appId" FROM "AppTag" WHERE id = $1"#)
        .bind(&req.app_tag_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(crate::api::internal)?;
    let Some(app_id) = app_id else {
        return Err(not_found("Tag not found"));
    };

    if !req.simulation_mode && req.tx_sig.is_none() {
        return Err(crate::api::bad_request("A confirmed transaction signature is required"));
    }
    if let Some(tx_sig) = &req.tx_sig {
        let existing: bool = sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "Stake" WHERE "txSig" = $1)"#)
            .bind(tx_sig)
            .fetch_one(&state.pool)
            .await
            .map_err(crate::api::internal)?;
        if existing {
            return Err(ApiError(axum::http::StatusCode::CONFLICT, "This transaction was already recorded".into()));
        }
    }

    let id: String = sqlx::query_scalar(
        r#"
        INSERT INTO "Stake" (id, "appTagId", "userId", amount, "txSig", "createdAt", active)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), true)
        RETURNING id
        "#,
    )
    .bind(&req.app_tag_id)
    .bind(&req.user_id)
    .bind(req.amount)
    .bind(&req.tx_sig)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    refresh_app_tag(&state.pool, &req.app_tag_id).await?;
    refresh_app(&state.pool, &app_id).await?;

    Ok(Json(serde_json::json!({ "stake": { "id": id, "amount": req.amount } })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WithdrawReq {
    user_id: String,
}

async fn withdraw(
    State(state): State<Arc<ApiState>>,
    Path(stake_id): Path<String>,
    Json(req): Json<WithdrawReq>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let row: Option<(String, String, bool)> =
        sqlx::query_as(r#"SELECT id, "userId", active FROM "Stake" WHERE id = $1"#)
            .bind(&stake_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(crate::api::internal)?;
    let Some((_, user_id, active)) = row else {
        return Err(not_found("Stake not found"));
    };
    if user_id != req.user_id {
        return Err(ApiError(axum::http::StatusCode::FORBIDDEN, "Not your stake".into()));
    }
    if !active {
        return Err(ApiError(axum::http::StatusCode::CONFLICT, "Stake already withdrawn".into()));
    }

    let app_tag_id: String = sqlx::query_scalar(
        r#"UPDATE "Stake" SET active = false, "withdrawnAt" = now() WHERE id = $1 RETURNING "appTagId""#,
    )
    .bind(&stake_id)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let app_id: String = sqlx::query_scalar(r#"SELECT "appId" FROM "AppTag" WHERE id = $1"#)
        .bind(&app_tag_id)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?;

    refresh_app_tag(&state.pool, &app_tag_id).await?;
    refresh_app(&state.pool, &app_id).await?;

    Ok(Json(serde_json::json!({ "withdrawn": true })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/stakes", get(list).post(create))
        .route("/stakes/:id/withdraw", post(withdraw))
}
