# AGENTS.md — repo root

nebulous.world: crowd-sourced app discovery on Solana (search/rank apps,
token-weighted voting, tag staking, ad-revenue sharing with stakers). Full
product pitch and setup steps live in [`README.md`](README.md) — read that
first for "how do I run this." This file is about "where is what."

## Layout

This is an **Anchor workspace at the repo root** with the product's Next.js
app nested inside it:

| Path | What | Docs |
| --- | --- | --- |
| [`app/`](app/) | Next.js 14 (App Router) product — UI, API routes, Prisma/Postgres, business logic | [`app/AGENTS.md`](app/AGENTS.md) |
| [`programs/nebulous_world/`](programs/nebulous_world/) | The on-chain Anchor program (votes, tag stakes, reward accrual/claims) | [`programs/nebulous_world/AGENTS.md`](programs/nebulous_world/AGENTS.md) |
| [`indexer/`](indexer/) | Rust service: indexes the program's accounts/instructions into Postgres, and is the app's **only** path to Solana RPC (no direct `Connection` anywhere in `app/`) | [`indexer/README.md`](indexer/README.md) (thorough — architecture diagram included) |
| [`tests/nebulous_world.ts`](tests/nebulous_world.ts) | Anchor/TS integration test entry (`anchor test`); the bulk of program tests are Rust, under `programs/nebulous_world/tests/` | — |
| [`migrations/deploy.ts`](migrations/deploy.ts) | Anchor deploy migration script | — |
| [`docs/plans/`](docs/plans/) | Point-in-time design/implementation planning docs (historical, not living docs) | — |
| [`DESIGN.md`](DESIGN.md) | Visual design tokens (colors, type scale, spacing, shadows) backing `app/tailwind.config.ts` | — |

`app/prisma/schema.prisma` is the one Postgres schema for the whole
product — the indexer has its own separate Postgres schema/migrations under
`indexer/migrations/` for on-chain data, kept intentionally distinct from
the app's DB.

## Running things

- **Anchor** commands (`anchor build`, `anchor deploy`, `anchor test`) run from
  this root.
- **App/npm** commands (`npm run dev`, `npm test`, `npm run db:*`, …) also run
  from this root — the root [`package.json`](package.json) proxies every
  script to `app/package.json` via `npm --prefix app run <script>` — or from
  `app/` directly, same result. Full script table in the README.
- One-shot local env: `npm run dev:all` (surfpool + program deploy + NEB
  launch + indexer + DB, then the dev server; tears itself down on Ctrl-C).
  See `app/scripts/dev-all.sh`.
- The product also runs with **no Solana toolchain at all** in *simulation
  mode* (default when `NEXT_PUBLIC_VOTE_TOKEN_MINT` is unset) — votes/stakes
  are recorded off-chain instead of via real transactions. See
  `app/src/lib/config.ts` and the README's "Simulation vs on-chain mode".

## Conventions worth knowing before editing

- No direct Solana RPC access from `app/` — everything on-chain goes through
  `indexer`'s HTTP API via `app/src/lib/indexerClient.ts`. If you're tempted
  to construct a `Connection` in the app, that's a sign to look at the
  indexer instead.
- Pure math is kept separate from DB/IO so it can be unit-tested in
  isolation: `app/src/lib/ranking.ts`, `revenue.ts`,
  `programs/nebulous_world/src/reward_math.rs`. DB-touching orchestration
  layers on top (`app/src/lib/engine.ts`) call into that pure math rather
  than duplicating it.
- Git worktrees under `.worktrees/` are the norm for feature branches in this
  repo — check `git worktree list` before assuming `main`'s working tree is
  the only work in flight.
