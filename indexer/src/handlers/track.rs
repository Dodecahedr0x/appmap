//! Ports `app/src/app/api/track/route.ts` + `app/src/lib/pageview.ts`'s
//! `getOrCreatePageView`. Visitor/session identity resolution (salted HMAC
//! of IP+UA, bot detection — `app/src/lib/tracking.ts`) has no Prisma
//! dependency and stays in Node: the caller resolves `visitorId`/
//! `sessionId`/`isBot` from request headers itself and only calls this
//! endpoint at all when `isBot` is false, so this module never needs to
//! know about bot detection.

use crate::api::{not_found, ApiError, ApiState};
use crate::handlers::engine::refresh_app;
use axum::extract::{Json, State};
use axum::routing::post;
use axum::Router;
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitorInfo {
    pub visitor_id: String,
    pub session_id: String,
    pub user_agent: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
}

/// Find the current session's page view for an app, creating one if none
/// exists — same dedupe-then-create shape as `pageview.ts`. Returns
/// `(id, created)`.
pub async fn get_or_create_page_view(
    pool: &PgPool,
    app_id: &str,
    visitor: &VisitorInfo,
    revenue_eligible: bool,
) -> Result<(String, bool), ApiError> {
    let existing: Option<String> = sqlx::query_scalar(
        r#"
        SELECT id FROM "PageView"
        WHERE "appId" = $1 AND "visitorId" = $2 AND "sessionId" = $3
        ORDER BY "createdAt" DESC
        LIMIT 1
        "#,
    )
    .bind(app_id)
    .bind(&visitor.visitor_id)
    .bind(&visitor.session_id)
    .fetch_optional(pool)
    .await
    .map_err(crate::api::internal)?;

    if let Some(id) = existing {
        return Ok((id, false));
    }

    let user_agent: String = visitor.user_agent.chars().take(300).collect();
    let id: String = sqlx::query_scalar(
        r#"
        INSERT INTO "PageView" (id, "appId", "visitorId", "sessionId", path, referrer, "userAgent", "revenueEligible", "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now())
        RETURNING id
        "#,
    )
    .bind(app_id)
    .bind(&visitor.visitor_id)
    .bind(&visitor.session_id)
    .bind(visitor.path.as_deref().unwrap_or("/"))
    .bind(&visitor.referrer)
    .bind(&user_agent)
    .bind(revenue_eligible)
    .fetch_one(pool)
    .await
    .map_err(crate::api::internal)?;

    Ok((id, true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackReq {
    app_id: String,
    #[serde(flatten)]
    visitor: VisitorInfo,
    #[serde(default)]
    revenue_eligible: bool,
}

async fn track(State(state): State<Arc<ApiState>>, Json(req): Json<TrackReq>) -> Result<Json<serde_json::Value>, ApiError> {
    let app_exists: bool = sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "App" WHERE id = $1)"#)
        .bind(&req.app_id)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?;
    if !app_exists {
        return Err(not_found("App not found"));
    }

    let (_, created) = get_or_create_page_view(&state.pool, &req.app_id, &req.visitor, req.revenue_eligible).await?;
    if !created {
        return Ok(Json(serde_json::json!({ "tracked": false, "reason": "duplicate" })));
    }

    // Cheap enough at demo scale — same comment as the original track.ts.
    refresh_app(&state.pool, &req.app_id).await?;

    Ok(Json(serde_json::json!({ "tracked": true, "revenueEligible": req.revenue_eligible })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new().route("/track", post(track))
}
