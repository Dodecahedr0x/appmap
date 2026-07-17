# dlmm-bridge

A small sidecar the Rust indexer (`../src/dlmm_bridge.rs`) spawns as a child
process at startup, and proxies two routes to (`../src/api.rs`'s `/pool` and
`/tx/buy-neb/build`). Never called directly by the Next.js app or a browser
— it's purely an implementation detail of the indexer's HTTP API.

## Why this isn't native Rust

Every other part of the indexer's API (`../src/api.rs`) builds
`nebulous_world` Anchor instructions natively in Rust — raw discriminator +
borsh-encoded args, no SDK needed. The NEB/USDC Meteora DLMM pool is
different: pricing a swap requires replicating Meteora's bin-based AMM math
(bin step, active-bin price, slippage, fee calculation) and there's no
official Rust SDK for it, only the well-tested `@meteora-ag/dlmm` npm
package this repo already depended on (and live-tested extensively) before
this pool ever had to be reachable from a Rust process. Re-deriving that
math in Rust from scratch, for code that moves real user funds, would be a
real correctness risk for comparatively little benefit — so this sidecar
just keeps running the same TypeScript logic that used to live in
`app/src/lib/dlmm.ts`/`app/src/hooks/useNebDlmmSwap.ts`, moved here instead
of deleted, with the signing step removed (wallets sign client-side; this
only ever returns unsigned transactions).

## Local development

You don't need to run this directly — `cargo run` in `indexer/` spawns it
automatically (see `../src/dlmm_bridge.rs`). One-time setup:

```bash
cd indexer/dlmm-bridge
npm install
```

To run it standalone (e.g. to test a route without the Rust indexer):

```bash
PORT=8091 SOLANA_RPC_URL=http://127.0.0.1:8899 NEB_DLMM_POOL=<pool address> npm start
```

## Routes

- `GET /pool` — NEB/USDC pool status (price, reserves, mint addresses), or
  404 if `NEB_DLMM_POOL` isn't set.
- `POST /tx/buy-neb/build` — `{ "usdcAmount": number, "user": "<base58 pubkey>" }`
  → `{ "transaction": "<base64, unsigned>" }`.
- `GET /health`
