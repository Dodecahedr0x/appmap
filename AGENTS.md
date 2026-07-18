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

**The database is owned by the indexer, not the app.** `indexer/migrations/`
is the one source of DDL for the whole product's Postgres schema (the
on-chain-derived tables it always had, plus — as of `005_app_schema.sql` —
the product schema that used to be pushed from `app/prisma/schema.prisma`),
applied automatically at indexer startup (`sqlx::migrate!()`, see
`indexer/src/db.rs`). `app/prisma/schema.prisma` still exists as the typed
Prisma Client codegen input the app's API routes read/write through
(`prisma generate`, run as part of `npm run build`), but the app never runs
`prisma db push`/`migrate` — its shape must be kept in sync with
`indexer/migrations/`'s CREATE TABLE statements by hand.

There is no seed script anywhere in this repo. `App`/`Tag`/`AppTag` rows are
created exclusively by the indexer's account/instruction pipeline
(`indexer/src/processors/product.rs`) when it observes confirmed
`init_app`/`suggest_tag` transactions on-chain — backfilled at startup by
replaying program history, kept current by the live crawler/subscription
after that. App creation itself is on-chain-first: the client builds and
signs an `init_app` (+ `suggest_tag`) transaction directly (see
`components/discover/CreateAppForm.tsx`, `POST /api/tx/create-app`) rather
than the app writing a Prisma row.

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

## Guidelines & code style

**Cross-language philosophy — comments explain *why*, not *what*.** This
codebase leans hard on doc comments to record non-obvious reasoning:
invariants, footguns, and rejected alternatives — not restatements of the
code. This is deliberate and consistent in both languages; match it rather
than adding comments that just describe what the next line does. Good
examples to pattern-match against: `app/src/lib/opengraph.ts` (why the
title-splitting regex handles colons differently from dashes),
`programs/nebulous_world/src/state.rs` (the `AppAccount`/`AppTagAccount`
CPI-signing footgun — sign with derivation seeds, not `.key()`),
`programs/nebulous_world/src/reward_math.rs` (why explicit checked
arithmetic instead of the `overflow-checks` build flag), and
`indexer/src/api.rs`'s module-level `//!` doc.

**Pure logic is kept separate from DB/IO**, so the interesting math can be
unit-tested without a database or a validator: `app/src/lib/ranking.ts`,
`revenue.ts`, `programs/nebulous_world/src/reward_math.rs`. The DB/RPC-touching
orchestration on top of that (`app/src/lib/engine.ts`) calls into this pure
logic rather than duplicating it — new business logic should follow the same
split.

**No direct Solana RPC access from `app/`** — everything on-chain goes
through `indexer`'s HTTP API via `app/src/lib/indexerClient.ts`. If you're
about to construct a `Connection` in `app/`, that's a sign to add an indexer
endpoint instead.

### TypeScript / Next.js (`app/`)

- `strict` TypeScript (`app/tsconfig.json`); avoid `any` — the codebase has
  none. Linting is `next lint` (`npm run lint`, defaults from
  `next/core-web-vitals` + `next/typescript`, no custom rules). No Prettier
  config — don't introduce one or bulk-reformat; match surrounding style by
  hand.
- Double-quoted strings, semicolons, `interface` for object shapes (`type`
  only for unions/derived types — `interface` outnumbers `type` roughly 5:1
  in `src/lib/`).
- Components are named function declarations —
  `export function ComponentName() { ... }` — never `const X = () => ...`.
  `"use client"` only at the top of files that actually need it (event
  handlers, hooks, browser APIs); everything else is a server component by
  default.
- Imports: external packages first, then internal — always via the `@/*`
  path alias (`@/lib/...`, `@/components/...`), never relative `../../`
  chains.
- API routes (`src/app/api/**/route.ts`): always wrap handlers in `handler()`
  from `@/lib/api`, respond via `ok()`/`fail()`, validate the request body
  with a Zod schema from `@/lib/validation.ts`, and throw `ApiError` for
  expected failures (auth, not-found, conflict) rather than returning
  ad hoc error shapes. See `app/AGENTS.md`'s API table for the existing
  routes to pattern-match against.
- Client-side async actions (vote, stake, claim, submit) follow one shape
  throughout the codebase: a `busy` boolean state, `try { … await …;
  toast.success(...) } catch { toast.error(...) } finally { setBusy(false) }`.
  Reuse it rather than inventing a new async-UI pattern.
- Styling is Tailwind, utility-first. Shared primitives
  (`.card`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`, `.input`,
  `.chip`/`.chip-active`) are `@apply`-based classes in
  `src/app/globals.css` — reach for those before writing a long ad hoc
  utility string, and add a new shared class there if a pattern repeats
  three-plus times rather than copy-pasting utilities.
- Tests: Vitest, colocated as `*.test.ts` next to the file it covers (see
  `app/src/lib/AGENTS.md`). Run with `npm test`.

### Rust (`programs/nebulous_world/`, `indexer/`)

- Toolchain pinned in `rust-toolchain.toml` (1.89.0, `rustfmt` + `clippy`
  installed). No custom `rustfmt.toml`/`clippy.toml` — defaults for both.
- On-chain math (`reward_math.rs`) uses **explicit checked arithmetic**
  (`checked_add`/`checked_mul`/…) throughout rather than relying on the
  `overflow-checks` profile flag — see that file's top comment for why (it
  doesn't protect the final narrowing cast to `u64`, and is an easy-to-lose
  implicit safety net besides).
- Anchor program errors are one `#[error_code] enum ErrorCode` in `error.rs`,
  one variant per invariant, each with a `#[msg("...")]` — don't `panic!`/
  `unwrap()` on a condition a caller can trigger.
- PDA-owning account structs (`state.rs`) document their exact seed list and
  any CPI-signing gotcha in a doc comment on the struct — follow that
  pattern for any new PDA account rather than leaving seed derivation
  implicit in the instruction handler alone.
- The indexer (`indexer/src/`) mirrors the app's API-layer shape in Rust:
  `anyhow` internally, handlers returning `Result<_, ApiError>` with a local
  `ApiError` that maps to a clean HTTP response — the same "typed error →
  clean JSON response" convention as `app/src/lib/api.ts`, just per-language.
- Tests: see `programs/nebulous_world/AGENTS.md` — two distinct suites
  (`cargo test` for the fast LiteSVM suite, `anchor test` for the
  real-validator TS suite); don't conflate them.

## Other conventions worth knowing

- Git worktrees under `.worktrees/` are the norm for feature branches in this
  repo — check `git worktree list` before assuming `main`'s working tree is
  the only work in flight.
- Commit messages follow a light conventional-commit style: `type: short
  imperative summary` (`feat: …`, `fix: …`, `docs: …`), body explaining *why*
  when it's not obvious from the diff.
