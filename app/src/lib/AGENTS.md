# AGENTS.md — `app/src/lib/`

The app's business logic, grouped by concern. Every file with a `*.test.ts`
sibling is Vitest-covered — check it before changing behavior; it's usually
the fastest way to understand a function's edge cases. See
[`../../AGENTS.md`](../../AGENTS.md) for the wider `app/` map.

## Pure logic — no DB, no I/O, safe to unit test in isolation

| File | What |
| --- | --- |
| [`ranking.ts`](ranking.ts) | The rank score formula: log-dampened vote/stake/traffic weights + a decaying freshness bonus. All tuning constants live here. |
| [`revenue.ts`](revenue.ts) | Stake-proportional ad-revenue split math, minus the protocol fee. |
| [`fuzzy.ts`](fuzzy.ts) | Fuzzy text matching used by `search.ts`. |
| [`rewards.ts`](rewards.ts) | Pending-reward math (`settlePendingRaw`) — mirrors the "reward per share" formula in `programs/nebulous_world/src/reward_math.rs`, so a wallet's pending claim can be computed client-side from on-chain accumulator state. |

## DB-backed orchestration

| File | What |
| --- | --- |
| [`engine.ts`](engine.ts) | Bridges the pure ranking/revenue math to Postgres: `refreshApp` (recompute an app's cached aggregates + rank after any vote/stake/view), epoch settlement. |
| [`search.ts`](search.ts) | Advanced search: DB-side filtering (status, stake/view ranges, tags, coarse text) + JS-side relevance scoring/fuzzy filtering, since SQLite (dev) has no first-class full-text index via Prisma. |
| [`serialize.ts`](serialize.ts) | Prisma row → `AppDTO`/`TagDTO` (`appInclude`, `serializeApp`) — the one place DB shape becomes API shape. |
| [`queries.ts`](queries.ts) | App-detail page queries (`getAppDetail`: app + recent votes + top stakers + traffic + snapshots). |
| [`appGraph.ts`](appGraph.ts) | Builds the app-similarity graph behind the Explore "Apps" map (shared-tag overlap). |
| [`tagGraph.ts`](tagGraph.ts) | Builds the tag co-occurrence graph behind the Explore "Tags" map. |
| [`explore.ts`](explore.ts) | Platform-wide stats for the Explore page header tiles. |
| [`snapshot.ts`](snapshot.ts) | Writes one `AppStatsSnapshot` row per app per day (trend charts) — driven by `scripts/dailySnapshot.ts`. |
| [`settlement.ts`](settlement.ts) | Epoch revenue settlement orchestration — driven by `scripts/settleEpoch.ts`. |
| [`pageview.ts`](pageview.ts) | Page-view dedupe/creation for `api/track`. |
| [`ads.ts`](ads.ts) | Ad-serving selection for `api/ads/serve`. |
| [`tracking.ts`](tracking.ts) | Shared traffic-tracking helpers. |

## External integrations

| File | What |
| --- | --- |
| [`opengraph.ts`](opengraph.ts) | Scrapes a URL's OpenGraph/Twitter-card metadata. `enrichWithOpenGraph` fills whichever of icon/tagline/description a submission left blank; `nameFromTitle` derives a short app name from a scraped title. Used by the Create-app flow (`api/apps/preview`, `api/apps` POST). |
| [`adsense.ts`](adsense.ts) | Google AdSense earnings fetch, feeding epoch settlement. |
| [`turnstile.ts`](turnstile.ts) | Cloudflare Turnstile token verification — gates whether a tracked page view counts as ad-revenue-eligible. |

## Solana / on-chain

| File | What |
| --- | --- |
| [`indexerClient.ts`](indexerClient.ts) | HTTP client to the indexer service — **the app's only path to Solana data or transactions**; nothing else here opens an RPC `Connection`. |
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
| [`api.ts`](api.ts) | `handler`/`ok`/`fail`/`ApiError`/`requireUser` — every `api/**/route.ts` is built on these for consistent JSON responses and auth guards. |
| [`validation.ts`](validation.ts) | Zod request schemas (`submitAppSchema`, `voteSchema`, `stakeSchema`, `searchSchema`, …). |

## Shared / misc

| File | What |
| --- | --- |
| [`prisma.ts`](prisma.ts) | Prisma client singleton. |
| [`config.ts`](config.ts) | Runtime config/env — `isSimulationMode()`, indexer base URL, ad CPM, etc. |
| [`constants.ts`](constants.ts) | Shared enums: `AppStatus`, `CATEGORIES`, `CHAINS`, `SORT_OPTIONS`, `TOKEN_SYMBOL`/`TOKEN_NAME`, `SITE_*`. |
| [`types.ts`](types.ts) | Shared DTOs: `AppDTO`, `TagDTO`, `SearchResult`, `ApiEnvelope`. |
| [`utils.ts`](utils.ts) | `cn`, `slugify`, `shortAddress`, `formatToken`, `formatNumber`, `hostname`, `formatDate`, `timeAgo`. |
