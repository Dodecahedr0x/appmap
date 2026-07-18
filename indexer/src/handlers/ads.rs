//! Ports `app/src/app/api/ads/serve/route.ts` + `ads/click/route.ts` +
//! `app/src/lib/ads.ts`'s `pickWeightedAd`.

use crate::api::{not_found, ApiError, ApiState};
use crate::handlers::engine::revenue_per_impression;
use crate::handlers::track::{get_or_create_page_view, VisitorInfo};
use axum::extract::{Json, State};
use axum::routing::post;
use axum::Router;
use rand::Rng;
use serde::Deserialize;
use std::sync::Arc;

struct AdRow {
    id: String,
    title: String,
    body: String,
    image_url: Option<String>,
    target_url: String,
    cpm: f64,
    weight: i32,
}

/// Same shape as `ads.ts`'s `pickWeightedAd`.
fn pick_weighted_ad(ads: &[AdRow]) -> Option<&AdRow> {
    let active: Vec<&AdRow> = ads.iter().filter(|a| a.weight > 0).collect();
    if active.is_empty() {
        return None;
    }
    let total: i32 = active.iter().map(|a| a.weight).sum();
    let mut r = rand::thread_rng().gen_range(0.0..1.0) * total as f64;
    for ad in &active {
        r -= ad.weight as f64;
        if r <= 0.0 {
            return Some(ad);
        }
    }
    active.last().copied()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServeReq {
    app_id: String,
    #[serde(flatten)]
    visitor: VisitorInfo,
}

async fn serve(State(state): State<Arc<ApiState>>, Json(req): Json<ServeReq>) -> Result<Json<serde_json::Value>, ApiError> {
    let app_exists: bool = sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "App" WHERE id = $1)"#)
        .bind(&req.app_id)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?;
    if !app_exists {
        return Err(not_found("App not found"));
    }

    let ads: Vec<AdRow> = sqlx::query_as::<_, (String, String, String, Option<String>, String, f64, i32)>(
        r#"SELECT id, title, body, "imageUrl", "targetUrl", cpm, weight FROM "Ad" WHERE active = true"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?
    .into_iter()
    .map(|(id, title, body, image_url, target_url, cpm, weight)| AdRow { id, title, body, image_url, target_url, cpm, weight })
    .collect();

    let Some(ad) = pick_weighted_ad(&ads) else {
        return Ok(Json(serde_json::json!({ "ad": null })));
    };

    let (page_view_id, _) = get_or_create_page_view(&state.pool, &req.app_id, &req.visitor, false).await?;

    let revenue = revenue_per_impression(ad.cpm);
    let impression_id: String = sqlx::query_scalar(
        r#"
        INSERT INTO "AdImpression" (id, "adId", "appId", "pageViewId", revenue, "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())
        RETURNING id
        "#,
    )
    .bind(&ad.id)
    .bind(&req.app_id)
    .bind(&page_view_id)
    .bind(revenue)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(serde_json::json!({
        "ad": {
            "id": ad.id,
            "title": ad.title,
            "body": ad.body,
            "imageUrl": ad.image_url,
            "targetUrl": ad.target_url,
        },
        "impressionId": impression_id,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClickReq {
    impression_id: String,
}

async fn click(State(state): State<Arc<ApiState>>, Json(req): Json<ClickReq>) -> Result<Json<serde_json::Value>, ApiError> {
    // Ignore unknown ids, same as the original route.
    let _ = sqlx::query(r#"UPDATE "AdImpression" SET clicked = true WHERE id = $1"#)
        .bind(&req.impression_id)
        .execute(&state.pool)
        .await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new().route("/ads/serve", post(serve)).route("/ads/click", post(click))
}
