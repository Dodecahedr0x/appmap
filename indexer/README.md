# nebulous-world-indexer

A [Carbon](https://github.com/sevenlabs-hq/carbon) indexer for the
`nebulous_world` Anchor program, AND the Next.js app's only path to Solana
RPC: nothing in `app/` constructs a `Connection` or talks to an RPC
endpoint directly — every on-chain read, every transaction build, and
every transaction submission is proxied through this service's HTTP API
(`src/api.rs`) instead (see `app/src/lib/indexerClient.ts`). Deployed as a
private Render service (see `render.yaml`) — no public HTTP surface, only
reachable on Render's internal network, since the browser never calls it
directly (the app's own `/api/**` routes are the public-facing proxy).

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

                    ┌─ reads indexed_account (no RPC) ──────────────────────┐
                    │                                                       ▼
app/src/lib/        ├─ getLatestBlockhash + builds an unsigned tx ──→ signed client-side
indexerClient.ts ───┤   (src/api.rs's /tx/* endpoints)                 by the connected wallet
  (HTTP)             │                                                       │
                    └─ sendRawTransaction + confirm (/tx/submit) ◀───────────┘

app/src/lib/        ── /pool, /tx/buy-neb/build ──→ dlmm-bridge sidecar (Node, spawned as a
indexerClient.ts                                     child process — see dlmm-bridge/README.md)
```

- **`src/backfill.rs`** — one-shot snapshot of every account the program
  owns, via `getProgramAccounts`, run once at startup before the live
  pipeline takes over (a fresh `programSubscribe` stream only ever sees
  *future* changes, not existing state). This is the ONLY place
  `getProgramAccounts` is called — everything else that needs current
  state reads `indexed_account` (kept live by the `programSubscribe`
  pipeline below) instead of re-scanning the program.
- **`src/main.rs`** — the live account pipeline: Carbon's
  `RpcProgramSubscribe` datasource feeds the generated decoder
  (`decoder/`), which feeds `AccountProcessor` (`src/processors/account.rs`).
  Also starts `src/api.rs`'s HTTP server and spawns the `dlmm-bridge`
  sidecar (`src/dlmm_bridge.rs`) alongside the pipeline.
- **`src/api.rs`** — the HTTP API the Next.js app calls instead of RPC:
  account reads (straight from `indexed_account`, no RPC per request),
  transaction building for the 6 `nebulous_world` instructions (raw
  instruction construction — discriminator + borsh args, no `anchor-client`
  dependency needed), transaction submission (`sendRawTransaction` +
  confirm), and proxying to `dlmm-bridge` for anything Meteora-DLMM-related.
- **`src/dlmm_bridge.rs`** — spawns `dlmm-bridge/` (see its own README) as
  a child process at startup.
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

`npm run setup:dev` (from the repo root — see `app/scripts/setup-dev.sh`)
builds and starts this automatically, as part of the full local dev
environment. To run it directly instead:

```bash
# From the repo root, with a local surfpool Surfnet and Postgres running:
cd indexer/dlmm-bridge && npm install && cd ..  # one-time
cd indexer
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/appmap_dev" \
NEXT_PUBLIC_SOLANA_RPC="http://127.0.0.1:8899" \
RUST_LOG=info \
cargo run
```

`RPC_WS_URL` defaults to the RPC URL with its scheme swapped
(`http`→`ws`/`https`→`wss`); surfpool's default RPC pubsub port (8900,
same as `solana-test-validator`'s) is also detected and substituted
automatically. Override `RPC_WS_URL` directly for any provider that
doesn't follow either convention.

The HTTP API listens on `INDEXER_API_PORT` (default `8090`) — set
`INDEXER_API_URL=http://127.0.0.1:8090` in `app/.env` to point the Next.js
app at it (this is also `app/.env.example`'s default, so local dev needs
no explicit setting).

## Tables

All tables live in the same database as the app's Prisma-managed schema,
under names that don't collide with it — see the doc comments in
`migrations/001_indexer_tables.sql` for what each one is for and why.
