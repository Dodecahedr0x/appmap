//! Ports `app/src/lib/appGraph.ts`, `app/src/lib/tagGraph.ts`, and
//! `app/src/lib/explore.ts` (platform-wide stats/trend for the Explore
//! page) — all read-only aggregate views over `App`/`AppTag`/`Tag`.

use crate::api::{ApiError, ApiState};
use axum::extract::{Json, Query, State};
use axum::routing::get;
use axum::Router;
use chrono::NaiveDateTime;
use crate::handlers::engine::to_rfc3339;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

// --- appGraph.ts ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppGraphNode {
    id: String,
    name: String,
    stake: f64,
    views: i32,
    votes: f64,
}

#[derive(Serialize)]
struct AppGraphEdge {
    source: String,
    target: String,
    shared: f64,
    weighted: f64,
}

const MAX_NEIGHBORS_PER_APP: usize = 6;

struct AppNode {
    slug: String,
    name: String,
    stake_total: f64,
    view_count: i32,
    vote_weight: f64,
    tags: Vec<(String, f64)>, // (tagId, stakeTotal)
}

fn edge_key(source: &str, target: &str) -> String {
    format!("{source}|{target}")
}

/// Same shape as `appGraph.ts`'s `buildAppGraph` — see that file's doc
/// comment for the Jaccard/weighted-Jaccard similarity rationale. `tags`
/// facet filtering (AND semantics) already happened at the call site, so
/// `apps` here is already the restricted set.
fn build_app_graph(apps: Vec<AppNode>) -> (Vec<AppGraphNode>, Vec<AppGraphEdge>) {
    let tagged: Vec<AppNode> = apps.into_iter().filter(|a| !a.tags.is_empty()).collect();

    let mut candidates: Vec<AppGraphEdge> = Vec::new();
    for i in 0..tagged.len() {
        for j in (i + 1)..tagged.len() {
            let a = &tagged[i];
            let b = &tagged[j];
            let b_tags: HashMap<&str, f64> = b.tags.iter().map(|(id, s)| (id.as_str(), *s)).collect();

            let mut intersection = 0i64;
            let mut sum_min = 0.0;
            for (tag_id, stake) in &a.tags {
                if let Some(&stake_b) = b_tags.get(tag_id.as_str()) {
                    intersection += 1;
                    sum_min += stake.min(stake_b);
                }
            }
            if intersection == 0 {
                continue;
            }
            let union = (a.tags.len() + b.tags.len()) as i64 - intersection;
            let shared = if union > 0 { intersection as f64 / union as f64 } else { 0.0 };
            let stake_union = sum_min.max(a.stake_total + b.stake_total - sum_min);
            let weighted = if stake_union > 0.0 { sum_min / stake_union } else { shared };

            candidates.push(AppGraphEdge { source: a.slug.clone(), target: b.slug.clone(), shared, weighted });
        }
    }

    let keep_shared = top_neighbor_keys(&candidates, |e| e.shared, MAX_NEIGHBORS_PER_APP);
    let keep_weighted = top_neighbor_keys(&candidates, |e| e.weighted, MAX_NEIGHBORS_PER_APP);
    let edges: Vec<AppGraphEdge> = candidates
        .into_iter()
        .filter(|e| {
            let key = edge_key(&e.source, &e.target);
            keep_shared.contains(&key) || keep_weighted.contains(&key)
        })
        .collect();

    let connected: HashSet<String> = edges.iter().flat_map(|e| [e.source.clone(), e.target.clone()]).collect();
    let nodes: Vec<AppGraphNode> = tagged
        .into_iter()
        .filter(|a| connected.contains(&a.slug))
        .map(|a| AppGraphNode { id: a.slug, name: a.name, stake: a.stake_total, views: a.view_count, votes: a.vote_weight })
        .collect();

    (nodes, edges)
}

fn top_neighbor_keys(edges: &[AppGraphEdge], weight_of: impl Fn(&AppGraphEdge) -> f64, k: usize) -> HashSet<String> {
    let mut by_node: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for e in edges {
        let key = edge_key(&e.source, &e.target);
        let weight = weight_of(e);
        for id in [&e.source, &e.target] {
            by_node.entry(id.clone()).or_default().push((key.clone(), weight));
        }
    }
    let mut keep = HashSet::new();
    for list in by_node.values_mut() {
        list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        for (key, _) in list.iter().take(k) {
            keep.insert(key.clone());
        }
    }
    keep
}

#[derive(Deserialize)]
struct GraphQuery {
    #[serde(default)]
    tags: Option<String>,
}

async fn app_graph(State(state): State<Arc<ApiState>>, Query(q): Query<GraphQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let tag_slugs: Vec<String> = q.tags.map(|s| s.split(',').filter(|x| !x.is_empty()).map(String::from).collect()).unwrap_or_default();

    let rows: Vec<(String, String, f64, i32, f64)> = sqlx::query_as(
        r#"SELECT slug, name, "stakeTotal", "viewCount", "voteWeight" FROM "App" WHERE status = 'approved'"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let mut apps = Vec::with_capacity(rows.len());
    for (slug, name, stake_total, view_count, vote_weight) in rows {
        let tag_rows: Vec<(String, f64, String)> = sqlx::query_as(
            r#"
            SELECT at."tagId", at."stakeTotal", t.slug
            FROM "AppTag" at JOIN "Tag" t ON t.id = at."tagId"
            JOIN "App" a ON a.id = at."appId"
            WHERE a.slug = $1
            "#,
        )
        .bind(&slug)
        .fetch_all(&state.pool)
        .await
        .map_err(crate::api::internal)?;

        // AND semantics: app must carry every selected tag slug.
        if !tag_slugs.is_empty() {
            let slugs: HashSet<&str> = tag_rows.iter().map(|(_, _, s)| s.as_str()).collect();
            if !tag_slugs.iter().all(|s| slugs.contains(s.as_str())) {
                continue;
            }
        }

        apps.push(AppNode {
            slug,
            name,
            stake_total,
            view_count,
            vote_weight,
            tags: tag_rows.into_iter().map(|(id, stake, _)| (id, stake)).collect(),
        });
    }

    let (nodes, edges) = build_app_graph(apps);
    Ok(Json(serde_json::json!({ "nodes": nodes, "edges": edges })))
}

// --- tagGraph.ts ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagGraphNode {
    id: String,
    name: String,
    stake: f64,
    app_count: i64,
}

#[derive(Serialize)]
struct TagGraphEdge {
    source: String,
    target: String,
    weight: i64,
    similarity: f64,
}

/// Same shape as `tagGraph.ts`'s `buildTagGraph`.
async fn tag_graph(State(state): State<Arc<ApiState>>) -> Result<Json<serde_json::Value>, ApiError> {
    let rows: Vec<(String, f64, String, String)> = sqlx::query_as(
        r#"
        SELECT at."appId", at."stakeTotal", t.slug, t.name
        FROM "AppTag" at
        JOIN "Tag" t ON t.id = at."tagId"
        JOIN "App" a ON a.id = at."appId"
        WHERE a.status = 'approved'
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    let mut node_stake: HashMap<String, (String, f64, i64)> = HashMap::new(); // slug -> (name, stake, appCount)
    let mut by_app: HashMap<String, Vec<String>> = HashMap::new();
    for (app_id, stake, slug, name) in rows {
        let entry = node_stake.entry(slug.clone()).or_insert((name, 0.0, 0));
        entry.1 += stake;
        entry.2 += 1;
        by_app.entry(app_id).or_default().push(slug);
    }

    let mut edge_counts: HashMap<String, i64> = HashMap::new();
    for tags in by_app.values() {
        for i in 0..tags.len() {
            for j in (i + 1)..tags.len() {
                let mut pair = [tags[i].clone(), tags[j].clone()];
                pair.sort();
                *edge_counts.entry(format!("{}|{}", pair[0], pair[1])).or_insert(0) += 1;
            }
        }
    }

    let nodes: Vec<TagGraphNode> = node_stake
        .iter()
        .map(|(slug, (name, stake, app_count))| TagGraphNode { id: slug.clone(), name: name.clone(), stake: *stake, app_count: *app_count })
        .collect();

    let edges: Vec<TagGraphEdge> = edge_counts
        .into_iter()
        .map(|(key, weight)| {
            let (source, target) = key.split_once('|').unwrap();
            let count_a = node_stake.get(source).map(|(_, _, c)| *c).unwrap_or(0);
            let count_b = node_stake.get(target).map(|(_, _, c)| *c).unwrap_or(0);
            let union = count_a + count_b - weight;
            let similarity = if union > 0 { weight as f64 / union as f64 } else { 0.0 };
            TagGraphEdge { source: source.to_string(), target: target.to_string(), weight, similarity }
        })
        .collect();

    Ok(Json(serde_json::json!({ "nodes": nodes, "edges": edges })))
}

// --- explore.ts ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformStatsDto {
    total_apps: i64,
    total_tags: i64,
    total_vote_weight: f64,
    total_stake: f64,
    total_views: i32,
}

async fn platform_stats(State(state): State<Arc<ApiState>>) -> Result<Json<PlatformStatsDto>, ApiError> {
    let (total_apps, total_vote_weight, total_stake, total_views): (i64, Option<f64>, Option<f64>, Option<i64>) =
        sqlx::query_as(
            r#"SELECT COUNT(*), SUM("voteWeight"), SUM("stakeTotal"), SUM("viewCount") FROM "App" WHERE status = 'approved'"#,
        )
        .fetch_one(&state.pool)
        .await
        .map_err(crate::api::internal)?;

    let total_tags: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT at."tagId")
        FROM "AppTag" at JOIN "App" a ON a.id = at."appId"
        WHERE a.status = 'approved'
        "#,
    )
    .fetch_one(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(PlatformStatsDto {
        total_apps,
        total_tags,
        total_vote_weight: total_vote_weight.unwrap_or(0.0),
        total_stake: total_stake.unwrap_or(0.0),
        total_views: total_views.unwrap_or(0) as i32,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewsTrendPointDto {
    date: String,
    total_views: i64,
}

async fn platform_views_trend(State(state): State<Arc<ApiState>>) -> Result<Json<Vec<ViewsTrendPointDto>>, ApiError> {
    let rows: Vec<(NaiveDateTime, Option<i64>)> = sqlx::query_as(
        r#"
        SELECT s.date, SUM(s."viewCount")
        FROM "AppStatsSnapshot" s JOIN "App" a ON a.id = s."appId"
        WHERE a.status = 'approved'
        GROUP BY s.date
        ORDER BY s.date ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(crate::api::internal)?;

    Ok(Json(
        rows.into_iter()
            .map(|(date, total_views)| ViewsTrendPointDto { date: to_rfc3339(date), total_views: total_views.unwrap_or(0) })
            .collect(),
    ))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new()
        .route("/apps/graph", get(app_graph))
        .route("/tags/graph", get(tag_graph))
        .route("/platform/stats", get(platform_stats))
        .route("/platform/views-trend", get(platform_views_trend))
}
