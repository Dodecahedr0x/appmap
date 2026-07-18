# x402 micropayments for the data API

Set via `/goal` for autonomous, unattended execution — decisions below were
made directly against research + codebase conventions rather than through
interactive back-and-forth, per the goal hook's instruction not to block on
the user.

## What

A small, separate "data API" product — `GET /api/data/*` — priced per
request in NEB and gated by [x402](https://www.x402.org) (the open,
HTTP-native micropayment standard built on the HTTP 402 status code:
Coinbase-originated, now a Linux Foundation project with Solana Foundation
as a launch member). Distinct from the app's own internal `/api/tags/*`,
`/api/apps/*` etc. routes, which stay free/ungated — those are called
directly by this app's own browser UI (ExploreMaps, MetricTrendCard, ...),
and a real human browsing the site was never going to sign a payment just
to load a chart.

## Why a separate route group, not gating the existing ones

The existing `/api/tags/graph`, `/api/tags/pack`, `/api/apps/graph` routes
are fetched client-side by this app's own React components. Putting an x402
gate on them would break the site's own UI for every visitor. x402's actual
target audience — autonomous agents and third-party integrations paying
per-call with no signup — gets its own namespace instead:

- `GET /api/data/platform-stats` — platform totals (apps/tags/votes/stake/views)
- `GET /api/data/platform-history` — daily on-chain metrics time series
- `GET /api/data/tags` — full tag leaderboard (stake + app count per tag)
- `GET /api/data/traffic?start&end` — per-app revenue-eligible page-view
  counts in a date range

The first three wrap indexer data that's already public elsewhere in a
different shape (the "expand" part is repackaging it as a stable, priced,
machine-consumable resource — not a UI graph payload); `traffic` is
genuinely new exposure — `platform.rs`'s traffic handler previously had no
public path at all, only used internally by the revenue-settlement job.

## Protocol shape (researched against the x402 v2 spec + Solana SDK)

- 402 response carries a base64-encoded JSON `PaymentRequirements` in a
  `PAYMENT-REQUIRED` header: `{ accepts: [{ scheme: "exact", network,
  amount, asset, payTo, maxTimeoutSeconds }], resource: { url, description,
  mimeType } }`.
- Client resubmits with a `PAYMENT-SIGNATURE` header: base64 JSON
  `{ payer, transaction: <base64 fully-signed serialized Solana
  transaction> }`. Unlike EVM's `transferWithAuthorization` signature
  scheme, Solana's x402 scheme is "sign and hand over a ready-to-submit
  transaction" — the resource server (here, the indexer, which already owns
  every Solana RPC interaction in this app) submits it directly rather than
  relaying to a third-party facilitator's `/verify`+`/settle`. Running our
  own facilitator logic instead of depending on an external hosted one
  (`x402.org/facilitator` et al.) is also the only way this works against a
  local Surfpool/devnet setup, which no public facilitator knows about.
- On success, a `PAYMENT-RESPONSE` header carries the settlement receipt
  (`{ settled: true, transaction: <signature> }`) alongside the actual data.

## Pricing — single source of truth

`app/src/lib/x402.ts` is the *only* place prices are defined — both the API
routes and the About page's pricing table import the same
`X402_ENDPOINTS` map, so they can't drift. The indexer's settlement
endpoint is deliberately generic (verify + submit a transfer matching
*caller-supplied* amount/mint/destination) rather than holding its own
price table — pricing knowledge lives in exactly one language, one file.

Degrades the same way every other on-chain feature in this app already
does: `isX402Enabled()` mirrors `isSimulationMode()` (both keyed off
whether a real token mint/treasury is configured) — with nothing
configured, `/api/data/*` serves data for free with a `simulated: true`
receipt instead of erroring, so the feature is fully exercisable without a
funded wallet, exactly like votes/stakes already work.

## Settlement verification (indexer, new `handlers/x402.rs`)

No new Cargo dependencies — the SPL Token program's `Transfer`/
`TransferChecked` instruction wire format is a stable, tiny, hand-decodable
layout (1-byte tag + u64 LE amount [+ 1-byte decimals]), and the
Associated Token Account address is a deterministic `find_program_address`
derivation computable with the `solana-pubkey` crate already in the
dependency graph — pulling in `spl-token` would risk version conflicts
against this project's already-pinned split `solana-*` v3 crates for no
real benefit.

`POST /x402/settle` accepts `{ signedTransaction, expectedAmountRaw,
expectedMint, expectedPayTo }` and rejects unless the transaction's
instructions are *exactly* zero-or-more ComputeBudget instructions followed
by one Token-program `Transfer`/`TransferChecked` instruction moving
`expectedAmountRaw` of `expectedMint` into `expectedPayTo`'s canonical
associated token account — anything else (extra instructions, wrong
amount, wrong destination) is rejected before the transaction is ever
submitted. Only then is it sent via the same `send_and_confirm_transaction`
path `/tx/submit` already uses.

## About page

New section between "How it works" and "Live stats": explains x402 in a
sentence, then a pricing table rendered directly from `X402_ENDPOINTS`
(can't go stale relative to the actual gate), plus a terminal-style
request/response example (matching DESIGN.md's Terminal Command Box
component) showing the 402 → pay → retry round trip concretely.

## Testing approach

Real on-chain settlement needs a funded wallet + running Surfpool, which
isn't something to spin up casually for a single session. What's both
feasible and actually the highest-value thing to verify: the instruction
whitelist/amount/destination validation logic (the security-critical part)
gets Rust unit tests against hand-built `Transaction`s — no RPC needed,
pure function in, verdict out. The TS-side pricing/header encode-decode
helpers get Vitest unit tests. The simulation-mode path (the default state
of this dev environment, and the one most people will actually hit) gets
verified end-to-end against a running dev server, the same way prior
worktrees in this session have.
