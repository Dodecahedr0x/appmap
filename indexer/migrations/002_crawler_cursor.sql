-- Persists the instruction crawler's (src/crawler.rs) "last seen signature"
-- cursor across restarts. Originally kept in memory only; that meant a
-- restart re-scanned from scratch (bounded to the most recent 1000
-- signatures per getSignaturesForAddress call), silently DROPPING any
-- older un-processed signatures rather than just redundantly re-processing
-- them. A single row, keyed by a fixed id so the schema can grow additional
-- cursors later without a migration.
CREATE TABLE IF NOT EXISTS crawler_cursor (
    id TEXT PRIMARY KEY,
    last_signature TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
