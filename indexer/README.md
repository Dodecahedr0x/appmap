# nebulous-world-indexer

A [Carbon](https://github.com/sevenlabs-hq/carbon) indexer for the
`nebulous_world` Anchor program: it tracks the current state of every
account the program owns, logs every instruction sent to it, and runs
periodic processing tasks that turn that raw on-chain data into
visualization-ready rows. Deployed as a private Render service (see
`render.yaml`) — it has no HTTP surface of its own, it just writes to the
same Postgres database the Next.js app reads from.

## Architecture

```
                    ┌─ getProgramAccounts (once, at startup) ─┐
                    │                                          ▼
solana RPC ─────────┤                                indexed_account (JSONB, one row per pubkey)
                    │
                    └─ programSubscribe (live) ───────────────┘

solana RPC ── getSignaturesForAddress + getTransaction (polled) ──→ indexed_instruction (append-only)
                                                                            │
                                                    every ROLLUP_INTERVAL_SECS
                                                                            ▼
                                                                visualization_rollup (time-bucketed counts)
```

- **`src/backfill.rs`** — one-shot snapshot of every account the program
  owns, via `getProgramAccounts`, run once at startup before the live
  pipeline takes over (a fresh `programSubscribe` stream only ever sees
  *future* changes, not existing state).
- **`src/main.rs`** — the live account pipeline: Carbon's
  `RpcProgramSubscribe` datasource feeds the generated decoder
  (`decoder/`), which feeds `AccountProcessor` (`src/processors/account.rs`).
- **`src/crawler.rs`** — polls for instructions instead of using Carbon's
  `RpcBlockSubscribe` datasource. `blockSubscribe` is disabled by default on
  `solana-test-validator` and, more importantly, on essentially every hosted
  RPC provider including the public devnet endpoint this app deploys
  against — a pipeline built on it would silently index nothing in
  production. `getSignaturesForAddress`/`getTransaction` are universally
  supported standard RPC methods, at the cost of polling latency instead of
  push updates.
- **`src/rollup.rs`** — the indexer's explicit "processing task for
  visualization": every `ROLLUP_INTERVAL_SECS`, rolls up how many of each
  instruction type landed on-chain into `visualization_rollup`, so
  consumers never have to aggregate the raw instruction log themselves.
- **`decoder/`** — generated from `target/idl/nebulous_world.json` via
  `npx @sevenlabs-hq/carbon-cli parse` and checked in as regular source
  (regenerating requires Node, which this otherwise-pure-Rust service
  doesn't otherwise need). One constant is hand-patched after generation —
  see the comment at the top of `decoder/src/lib.rs`.

## Why carbon-core is pinned to 0.12.0

`carbon-cli` (the npm codegen tool) hasn't shipped a release targeting
`carbon-core` 1.0.0 yet, and the two have breaking API changes between
them. Every Carbon crate in this workspace is pinned to `0.12.0` so the
generated decoder and the pipeline code speak the same trait versions.
`carbon-rpc-gpa-datasource` and `carbon-rpc-transaction-crawler-datasource`
are only published at 1.0.0, which is why the account backfill
(`src/backfill.rs`) and the instruction crawler (`src/crawler.rs`) are
hand-rolled directly against `solana-client` instead of using those crates.

## Local development

```bash
# From the repo root, with a local solana-test-validator and Postgres running:
cd indexer
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/appmap_dev" \
NEXT_PUBLIC_SOLANA_RPC="http://127.0.0.1:8899" \
RUST_LOG=info \
cargo run
```

`RPC_WS_URL` defaults to the RPC URL with its scheme swapped
(`http`→`ws`/`https`→`wss`); `solana-test-validator`'s default RPC pubsub
port (8900) is also detected and substituted automatically. Override
`RPC_WS_URL` directly for any provider that doesn't follow either
convention.

## Tables

All tables live in the same database as the app's Prisma-managed schema,
under names that don't collide with it — see the doc comments in
`migrations/001_indexer_tables.sql` for what each one is for and why.
