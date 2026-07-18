//! Ports `app/src/app/api/tags/route.ts` — tag list with usage + total
//! stake, for facets/discovery.

use crate::api::{ApiError, ApiState};
use axum::extract::{Json, Query, State};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagListEntryDto {
    id: String,
    slug: String,
    name: String,
    app_count: i64,
    stake_total: f64,
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    q: Option<String>,
}

async fn list(State(state): State<Arc<ApiState>>, Query(query): Query<ListQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let q = query.q.map(|s| s.to_lowercase()).unwrap_or_default();
    let rows: Vec<(String, String, String, i64, f64)> = sqlx::query_as(
        r#"
        SELECT t.id, t.slug, t.name,
               COUNT(at.id) as app_count,
               COALESCE(SUM(at."stakeTotal"), 0) as stake_total
        FROM "Tag" t
        LEFT JOIN "AppTag" at ON at."tagId" = t.id
        WHERE $1 = '' OR t.name ILIKE '%' || $1 || '%'
        GROUP BY t.id, t.slug, t.name
        ORDER BY app_count DESC, stake_total DESC
        "#,
    )
    .bind(&q)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let tags: Vec<TagListEntryDto> = rows
        .into_iter()
        .map(|(id, slug, name, app_count, stake_total)| TagListEntryDto { id, slug, name, app_count, stake_total })
        .collect();

    Ok(Json(serde_json::json!({ "tags": tags })))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new().route("/tags", get(list))
}
