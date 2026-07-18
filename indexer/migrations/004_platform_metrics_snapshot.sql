-- Periodic platform-wide snapshot of on-chain-derived metrics — the time
-- series backing the Explore page's metric trend charts (apps indexed,
-- tags indexed, total vote stake, total tag stake). One row per
-- observation, no upsert — mirrors the shape the old neb_pool_snapshot
-- table used (see 003_drop_neb_pool_snapshot.sql) before NEB's sale moved
-- off-chain: a point-in-time gauge, not an additive counter like
-- visualization_rollup.
CREATE TABLE IF NOT EXISTS platform_metrics_snapshot (
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    app_count BIGINT NOT NULL,
    tag_count BIGINT NOT NULL,
    total_vote_stake BIGINT NOT NULL,
    total_tag_stake BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_metrics_snapshot_captured_at_idx ON platform_metrics_snapshot (captured_at);
