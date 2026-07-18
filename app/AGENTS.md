# AGENTS.md — `app/`

Next.js 14 (App Router) + TypeScript product. See the [repo-root
AGENTS.md](../AGENTS.md) for the wider workspace, and the [root
README](../README.md) for setup/run commands. Business logic is dense enough
to get its own map: [`src/lib/AGENTS.md`](src/lib/AGENTS.md).

## Directory map

| Path | What |
| --- | --- |
| `src/app/` | Routes (App Router pages) + `api/**` (REST API) — table below |
| `src/components/` | React components, one folder per feature area (see below) |
| `src/lib/` | Business logic, indexer HTTP client, external integrations — [own AGENTS.md](src/lib/AGENTS.md) |
| `src/hooks/` | Client hooks wrapping wallet-adapter + `lib/txClient.ts` for on-chain actions (vote, stake, claim, buy) |
| `scripts/` | One-off/ops scripts (daily snapshot, epoch settlement, NEB launch, dev env setup/teardown) — see the root README's script table. These call the indexer's HTTP API too, same as the app itself — no database access here either |
| `public/` | Static assets |

### Pages (`src/app/`)

| Route | File |
| --- | --- |
| `/` | `page.tsx` → `components/discover/Discover.tsx` — search, filters, results grid, Create-app modal |
| `/app/[slug]` | `app/[slug]/page.tsx` — app detail: stats, vote/stake panels, trend chart, ad slot |
| `/explore` | `explore/page.tsx` → `components/explore/ExploreMaps.tsx` — platform stats + app/tag force-graph maps |
| `/rewards` | `rewards/page.tsx` — buy NEB, pool analytics, claim rewards |

### API (`src/app/api/`)

All routes use the `handler`/`ok`/`fail`/`ApiError` helpers in
[`src/lib/api.ts`](src/lib/api.ts) for consistent JSON responses and auth
guards (`requireUser`).

| Group | Routes | Purpose |
| --- | --- | --- |
| Apps | `apps` (GET search only), `apps/[slug]`, `apps/by-id/[appId]`, `apps/graph`, `apps/related` | Search/facets, app detail, polling for the indexer to have caught up right after creation, the Explore "Apps" similarity graph, related-apps lookups. No POST — creation is on-chain-first, see `tx/create-app` below |
| Tags | `tags`, `tags/graph` | Tag facets, the Explore "Tags" co-occurrence graph. No POST — adding a tag is on-chain-first, see `tx/suggest-tag` below |
| Voting/staking (DB) | `vote`, `vote/withdraw`, `stake`, `stake/withdraw` | Record a vote/stake *after* the on-chain tx confirms (simulation mode: the whole effect) |
| Transactions | `tx/create-app`, `tx/suggest-tag`, `tx/vote`, `tx/withdraw-vote`, `tx/stake-tag`, `tx/withdraw-tag-stake`, `tx/claim-vote-reward`, `tx/claim-tag-reward`, `tx/buy-neb`, `tx/submit` | The `tx/*` build routes each construct one unsigned transaction (via the indexer) for the wallet to sign; `tx/submit` relays the signed result back through the indexer. Full flow behind `src/hooks/*`: build → wallet signs → `tx/submit`. Unlike the others, `tx/create-app`/`tx/suggest-tag` have no DB-record step afterward — the indexer creates the `App`/`Tag`/`AppTag` rows itself once it observes the confirmed transaction (see root `AGENTS.md`) |
| On-chain reads | `accounts/app/[appId]`, `accounts/app-tag/[appId]/[tagSlug]`, `accounts/vote-position/[appId]`, `accounts/stake-position/[appId]/[tagSlug]`, `balances/[owner]/[mint]`, `pool` | Read-through proxies to the indexer (never a direct RPC call) |
| Rewards | `rewards/positions` | A signed-in user's vote/stake positions, for the Rewards page's claim list |
| Ads/traffic | `ads/serve`, `ads/click`, `track` | Serve an ad impression, record a click, record a page view (Turnstile-gated for revenue eligibility) |
| Auth | `auth/challenge`, `auth/verify`, `auth/me`, `auth/logout` | Sign-In-With-Solana: issue a nonce, verify the signed message, session cookie, logout |
| Data API (x402-priced) | `data/platform-stats`, `data/platform-history`, `data/tags`, `data/traffic` | A separate, [x402](https://www.x402.org)-gated data API for third-party/agent consumers — priced per request in NEB, see [`src/lib/x402.ts`](src/lib/x402.ts) and the About page's "Data API" section. Distinct from the free routes above, which this app's own UI depends on directly |

### Components (`src/components/`)

Organized by feature; folder name tells you the page it belongs to:
`discover/` (search + Create-app form + filter panel), `explore/` (force-graph
maps — `ForceMap.tsx` is the shared canvas engine, `AppMap`/`TagMap` are thin
wrappers), `app/` (app-detail panels: vote, tag-stake, traffic, trend chart),
`rewards/`, `token/` (buy panel), `ads/`, `charts/` (dependency-free SVG
sparkline), `ui/` (Modal, Toaster — generic, app-agnostic), `providers/`
(wallet + auth context). `AppCard.tsx`, `AppShell.tsx`, `Navbar.tsx`,
`ConnectButton.tsx` live at the top level since they're used across pages.

## Simulation vs on-chain mode

If `NEXT_PUBLIC_VOTE_TOKEN_MINT` is unset, the app runs in **simulation
mode**: votes/stakes/claims are recorded straight to Postgres with no real
transaction. Set it (and deploy the program) to require real, confirmed
Solana transactions instead. Check with `isSimulationMode()` in
[`src/lib/config.ts`](src/lib/config.ts) before assuming either mode in new
code — most vote/stake/claim UI branches on it.

## Testing

Vitest, colocated `*.test.ts` next to their subject in `src/lib/`. Run with
`npm test` (from here or the repo root). `npm run typecheck` needs
`anchor build` to have run first (it generates `target/idl/*.json` and
`target/types/*.ts`, which `src/lib/anchorClient.ts` imports types from).

## Styling

Tailwind, tokens defined in `tailwind.config.ts` and documented in
[`../DESIGN.md`](../DESIGN.md) (colors, type scale, spacing, radii, shadows).
Shared component classes (`.card`, `.btn*`, `.input`, `.chip*`) live in
`src/app/globals.css`.
