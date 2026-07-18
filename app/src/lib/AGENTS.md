# AGENTS.md — `app/src/lib/`

The app's business logic, grouped by concern. Every file with a `*.test.ts`
sibling is Vitest-covered — check it before changing behavior; it's usually
the fastest way to understand a function's edge cases. See
[`../../AGENTS.md`](../../AGENTS.md) for the wider `app/` map.

## Pure logic — no DB, no I/O, safe to unit test in isolation

There is no DB-backed orchestration layer in `app/` any more — search,
ranking, ad-revenue distribution, fuzzy matching, app-detail queries, the
Explore graphs/stats, daily snapshots, and epoch settlement all moved to
`indexer/src/handlers/**` (plain SQL via `sqlx`) along with the database
itself. What's left here is genuinely DB-free:

| File | What |
| --- | --- |
| [`rewards.ts`](rewards.ts) | Pending-reward math (`settlePendingRaw`) — mirrors the "reward per share" formula in `programs/nebulous_world/src/reward_math.rs`, so a wallet's pending claim can be computed client-side from on-chain accumulator state. |
| [`settlement.ts`](settlement.ts) | `allocateByTrafficShare` — pure traffic-weighted allocation math for `scripts/settleEpoch.ts`. |
| [`tracking.ts`](tracking.ts) | Visitor/session identity derivation (salted HMAC of IP+UA) + bot heuristic — resolved here (needs the tracking secret + raw request headers) and passed already-derived to the indexer's `/track`/`/ads/serve` endpoints. |

## External integrations

| File | What |
| --- | --- |
| [`opengraph.ts`](opengraph.ts) | Scrapes a URL's OpenGraph/Twitter-card metadata. `enrichWithOpenGraph` fills whichever of icon/tagline/description an app is still missing; `nameFromTitle` derives a short app name from a scraped title. Used by `scripts/backfillOpengraph.ts`. |
| [`adsense.ts`](adsense.ts) | Google AdSense earnings fetch, feeding epoch settlement. |
| [`turnstile.ts`](turnstile.ts) | Cloudflare Turnstile token verification — gates whether a tracked page view counts as ad-revenue-eligible. |

## Solana / on-chain

| File | What |
| --- | --- |
| [`indexerClient.ts`](indexerClient.ts) | HTTP client to the indexer service — **the app's only path to Solana data or transactions, AND its only path to the database** (search, votes, stakes, ads, revenue, users, ...); nothing else here opens an RPC `Connection` or a Postgres connection. |
| [`anchorClient.ts`](anchorClient.ts) | Anchor program client construction + PDA derivation helpers (client-side, read-only — needs `anchor build`'s generated IDL/types). |
| [`txClient.ts`](txClient.ts) | Client-side sign-and-submit helper wrapping `wallet-adapter` + `indexerClient.ts`; backs `src/hooks/*`. |

## Auth

| File | What |
| --- | --- |
| [`session.ts`](session.ts) | Session cookie issuance/verification, sign-in nonce handling. |
| [`solana-auth.ts`](solana-auth.ts) | Sign-In-With-Solana: builds the challenge message, verifies the ed25519 signature. |

## API/validation plumbing

| File | What |
| --- | --- |
| [`api.ts`](api.ts) | `handler`/`ok`/`fail`/`ApiError`/`requireUser` — every `api/**/route.ts` is built on these for consistent JSON responses and auth guards. `requireUser` looks the session's user up via `indexerClient.ts`, not a DB call. |
| [`validation.ts`](validation.ts) | Zod request schemas (`buildCreateAppTxSchema`, `voteSchema`, `stakeSchema`, `searchSchema`, …). |

## Shared / misc

| File | What |
| --- | --- |
| [`config.ts`](config.ts) | Runtime config/env — `isSimulationMode()`, indexer base URL, ad CPM, etc. |
| [`constants.ts`](constants.ts) | Shared enums: `AppStatus`, `CATEGORIES`, `CHAINS`, `SORT_OPTIONS`, `TOKEN_SYMBOL`/`TOKEN_NAME`, `SITE_*`. |
| [`types.ts`](types.ts) | Shared DTOs: `AppDTO`, `TagDTO`, `SearchResult`, `ApiEnvelope`. |
| [`utils.ts`](utils.ts) | `cn`, `slugify`, `shortAddress`, `formatToken`, `formatNumber`, `hostname`, `formatDate`, `timeAgo`. |
