//! Ports `app/src/app/api/vote/route.ts` + `vote/withdraw/route.ts`. Session
//! resolution (who's calling) stays entirely in the Next.js layer (HMAC
//! cookie, no DB — see `app/src/lib/session.ts`); these endpoints trust the
//! `userId` the caller passes, same as every on-chain-tx-building endpoint
//! in `src/api.rs` trusts the `user` pubkey it's given.

use crate::api::{ApiError, ApiState};
use crate::handlers::engine::refresh_app;
use axum::extract::{Json, Path, Query, State};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetQuery {
    app_id: String,
    user_id: String,
}

#[derive(Serialize)]
struct VoteDto {
    id: String,
    amount: f64,
}

async fn get_vote(State(state): State<Arc<ApiState>>, Query(q): Query<GetQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let vote: Option<(String, f64)> = sqlx::query_as(
        r#"SELECT id, amount FROM "Vote" WHERE "appId" = $1 AND "userId" = $2 AND active = true LIMIT 1"#,
    )
    .bind(&q.app_id)
    .bind(&q.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(serde_json::json!({ "vote": vote.map(|(id, amount)| VoteDto { id, amount }) })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReq {
    app_id: String,
    user_id: String,
    amount: f64,
    tx_sig: Option<String>,
}

async fn create(State(state): State<Arc<ApiState>>, Json(req): Json<CreateReq>) -> Result<Json<serde_json::Value>, ApiError> {
    let app_exists: bool = sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "App" WHERE id = $1)"#)
        .bind(&req.app_id)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?;
    if !app_exists {
        return Err(crate::api::not_found("App not found"));
    }

    if let Some(tx_sig) = &req.tx_sig {
        let existing: bool = sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "Vote" WHERE "txSig" = $1)"#)
            .bind(tx_sig)
            .fetch_one(&state.pool)
            .await
            .map_err(crate::api::internal)?;
        if existing {
            return Err(crate::api::conflict("This transaction was already recorded"));
        }
    }

    let id: String = sqlx::query_scalar(
        r#"
        INSERT INTO "Vote" (id, "appId", "userId", amount, "txSig", "createdAt", active)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), true)
        RETURNING id
        "#,
    )
    .bind(&req.app_id)
    .bind(&req.user_id)
    .bind(req.amount)
    .bind(&req.tx_sig)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    refresh_app(&state.pool, &req.app_id).await?;

    if let Err(e) = crate::handlers::xp::award(
        &state.pool,
        &req.user_id,
        "vote",
        Some(&req.app_id),
        crate::handlers::xp::XP_VOTE,
    )
    .await
    {
        log::warn!("failed to award vote XP for user {}: {e}", req.user_id);
    }

    let updated: (f64, i32, f64) = sqlx::query_as(
        r#"SELECT "voteWeight", "voteCount", "rankScore" FROM "App" WHERE id = $1"#,
    )
    .bind(&req.app_id)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(serde_json::json!({
        "vote": { "id": id, "amount": req.amount, "txSig": req.tx_sig },
        "app": { "voteWeight": updated.0, "voteCount": updated.1, "rankScore": updated.2 },
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WithdrawReq {
    user_id: String,
    /// Withdraw only part of the vote, mirroring `withdraw_vote`'s on-chain
    /// `amount` parameter — see `handlers/stakes.rs::withdraw` for the same
    /// pattern on tag stakes.
    amount: Option<f64>,
}

async fn withdraw(
    State(state): State<Arc<ApiState>>,
    Path(vote_id): Path<String>,
    Json(req): Json<WithdrawReq>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let row: Option<(String, String, bool, f64)> =
        sqlx::query_as(r#"SELECT id, "userId", active, amount FROM "Vote" WHERE id = $1"#)
            .bind(&vote_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(crate::api::internal)?;
    let Some((_, user_id, active, current_amount)) = row else {
        return Err(crate::api::not_found("Vote not found"));
    };
    if user_id != req.user_id {
        return Err(crate::api::forbidden("Not your vote"));
    }
    if !active {
        return Err(crate::api::conflict("Vote already withdrawn"));
    }
    if let Some(amount) = req.amount {
        if amount <= 0.0 {
            return Err(crate::api::bad_request("Amount must be positive".to_string()));
        }
        if amount > current_amount {
            return Err(crate::api::bad_request("Amount exceeds vote balance".to_string()));
        }
    }

    let full_withdrawal = req.amount.is_none_or(|amount| amount >= current_amount);

    let app_id: String = if full_withdrawal {
        sqlx::query_scalar(
            r#"UPDATE "Vote" SET active = false, "withdrawnAt" = now() WHERE id = $1 RETURNING "appId""#,
        )
        .bind(&vote_id)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?
    } else {
        sqlx::query_scalar(r#"UPDATE "Vote" SET amount = amount - $2 WHERE id = $1 RETURNING "appId""#)
            .bind(&vote_id)
            .bind(req.amount.unwrap())
            .fetch_one(&state.pool)
            .await
            .map_err(crate::api::internal)?
    };

    refresh_app(&state.pool, &app_id).await?;

    Ok(Json(serde_json::json!({ "withdrawn": true, "fullWithdrawal": full_withdrawal })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/votes", get(get_vote).post(create))
        .route("/votes/:id/withdraw", post(withdraw))
}
