-- Tables owned by the Carbon indexer (sqlx migrations), living in the same
-- Postgres database as the Next.js app's Prisma-managed tables but with no
-- overlap in names — Prisma's `db push` only ever touches tables declared
-- in app/prisma/schema.prisma, so these coexist safely.

-- Raw indexed account state, keyed by pubkey — one row per account, upserted
-- on every observed change (initial getProgramAccounts backfill, then
-- ongoing programSubscribe updates). Heterogeneous account types (Config,
-- AppAccount, VotePosition, Tag, AppTagStake, StakePosition, NebPool) share
-- this table via JSONB, mirroring Carbon's own postgres-graphql example
-- rather than one table per account type.
CREATE TABLE IF NOT EXISTS indexed_account (
    pubkey TEXT PRIMARY KEY,
    account_type TEXT NOT NULL,
    owner TEXT NOT NULL,
    lamports BIGINT NOT NULL,
    slot BIGINT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS indexed_account_type_idx ON indexed_account (account_type);

-- Append-only on-chain event log: one row per decoded instruction observed
-- in a confirmed block for our program — independent of (and a source of
-- truth to cross-check against) the app's own API-recorded Vote/Stake/
-- NebPurchase ledger, which only reflects what happened through the app's
-- own UI/API rather than the chain directly.
CREATE TABLE IF NOT EXISTS indexed_instruction (
    id BIGSERIAL PRIMARY KEY,
    signature TEXT NOT NULL,
    instruction_index INT NOT NULL,
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ,
    instruction_name TEXT NOT NULL,
    data JSONB NOT NULL,
    accounts JSONB NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (signature, instruction_index)
);
CREATE INDEX IF NOT EXISTS indexed_instruction_name_idx ON indexed_instruction (instruction_name);
CREATE INDEX IF NOT EXISTS indexed_instruction_slot_idx ON indexed_instruction (slot);

-- Point-in-time snapshots of the NEB single-sided sale pool, one row per
-- observed on-chain change — the historical price/supply time series this
-- indexer makes possible (the app's own DB only ever has NebPool's current
-- state, never its history — see app/prisma/schema.prisma).
CREATE TABLE IF NOT EXISTS neb_pool_snapshot (
    id BIGSERIAL PRIMARY KEY,
    pubkey TEXT NOT NULL,
    slot BIGINT NOT NULL,
    total_supply BIGINT NOT NULL,
    remaining_supply BIGINT NOT NULL,
    sol_raised BIGINT NOT NULL,
    virtual_sol_reserves BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neb_pool_snapshot_pubkey_slot_idx ON neb_pool_snapshot (pubkey, slot);

-- Periodic processing-task output: time-bucketed counts of on-chain
-- activity per instruction type, computed from indexed_instruction on an
-- interval — the indexer's explicit "processing for visualization"
-- responsibility, distinct from the event-driven inserts above.
CREATE TABLE IF NOT EXISTS visualization_rollup (
    id BIGSERIAL PRIMARY KEY,
    bucket_start TIMESTAMPTZ NOT NULL,
    bucket_end TIMESTAMPTZ NOT NULL,
    instruction_name TEXT NOT NULL,
    event_count BIGINT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bucket_start, instruction_name)
);
