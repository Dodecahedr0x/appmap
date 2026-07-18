# nebulous.world

Crowd-sourced app discovery with **advanced search & visualization**,
**Solana-powered voting**, **tag staking**, and **traffic-based ad-revenue
sharing**.

- 🔎 **Discover** — advanced search with tag/category/chain facets and a
  transparent ranking that blends token-weighted votes, stake, traffic, and
  freshness.
- 🗳️ **Vote** — commit a Solana SPL token to an app; votes are token-weighted
  and feed directly into ranking.
- 🏷️ **Tags & staking** — anyone can suggest a tag for an app; users stake
  tokens behind tags they believe in. Stake boosts ranking and earns revenue.
- 📈 **Ads & revenue sharing** — app pages track (privacy-preserving) traffic
  and serve ads. Ad revenue is distributed to the app's stakers — across all its
  tags — proportional to their stake.
- 📊 **Explore** — platform stats, a similar-apps map, and a tag map, both
  clustered live by shared tags/stake.

## Tech stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript               |
| Styling    | Tailwind CSS                                        |
| Database   | Postgres, owned entirely by the indexer (Rust/`sqlx`) — the app has no DB client of its own |
| Wallet     | `@solana/wallet-adapter` (Phantom, Solflare, …)     |
| Auth       | Sign-In-With-Solana (ed25519 signature, no passwords) |
| Charts     | Recharts                                            |
| On-chain   | Anchor program (`programs/nebulous_world`) for vote/stake/revenue |

## Repo layout

This is an Anchor workspace at the repo root (`Anchor.toml`, `Cargo.toml`,
`programs/`, `tests/`) with the Next.js web app contained in [`app/`](app/).
Anchor-related commands (`anchor build`, `anchor deploy`, `anchor test`) run
from the repo root. App commands (`npm run dev`, `npm test`, etc.) also run
from the repo root — the root `package.json` proxies every `app/package.json`
script via `npm --prefix app run <script>` — or from `app/` directly if you
prefer. Installing dependencies is the one exception: the root `npm install`
only installs the Anchor workspace's own deps, so the app's still need a
one-time `npm install` inside `app/`.

## Getting started

The database is owned by the indexer, not the app — it applies its own
schema on startup and is the only thing that ever writes an `App`/`Tag`
row (see "Database ownership" below and root `AGENTS.md`). There is no
"push schema and seed demo data" step any more: run the indexer at least
once and it creates the schema itself; the database then starts genuinely
empty until real on-chain activity (via the app's "Create app" flow, votes,
stakes, ...) gives it something to index. `npm run setup:dev`/`dev:all`
(below) is the easiest way to get both a local chain and the indexer
running together:

```bash
cd app && npm install && cd ..  # one-time: install the app's own deps
cp app/.env.example app/.env    # tweak if needed
npm run setup:dev               # surfpool + program deploy + NEB launch + indexer
npm run dev                     # http://localhost:3000
```

`setup:dev` (and `test`) auto-provisions a local Postgres via Homebrew the
first time you run them — installs `postgresql@15` if missing, starts it,
and creates the `nebulous_world_dev`/`nebulous_world_test` role and database
(see `app/scripts/ensure-postgres.sh`). Point `DATABASE_URL` at your own
instance instead if you'd rather manage Postgres yourself.

This app has no Solana RPC connection of its own — every on-chain
read/write goes through the indexer instead (see `indexer/README.md` and
`app/src/lib/indexerClient.ts`) — so **the indexer must be running** even
in simulation mode (see below), since it owns the database schema. To set
everything up by hand instead of via `setup:dev`, from the repo root:

```bash
anchor build                  # generates target/idl/nebulous_world.json + target/types/nebulous_world.ts,
                                # needed by scripts/settleEpoch.ts and scripts/launch-neb/, not the app itself
surfpool start --network mainnet --airdrop-keypair-path ~/.config/solana/id.json
                                # in a separate terminal — forks mainnet, so real
                                # programs (DLMM, Metaplex) and mints (USDC) are
                                # fetched on demand, no manual account cloning
anchor deploy --provider.cluster localnet
cd indexer/dlmm-bridge && npm install && cd ..  # one-time
cd indexer && cargo run          # in a separate terminal — see indexer/README.md
```

then set `NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID` in `app/.env` (and
`indexer`'s env — see `indexer/README.md`) to the deployed program id, and
run `npm run launch:neb` (see below) to mint NEB and set
`NEXT_PUBLIC_VOTE_TOKEN_MINT`/`NEXT_PUBLIC_NEB_DLMM_POOL`.

Or run all of the above (install, `.env`, `anchor build`, a local surfpool
Surfnet with SOL + USDC airdropped to your dev keypair, program deploy, the
NEB launch, and starting the indexer — which applies its own database
schema on startup) in one shot with
`npm run setup:dev` — see `app/scripts/setup-dev.sh`. It requires the
Solana/Anchor/Rust toolchain and [surfpool](https://surfpool.run)
(`curl -sL https://run.surfpool.run/ | bash`), and leaves the Surfnet and
the indexer running in the background for `npm run dev` to talk to. Wind
everything back down with `npm run teardown:dev` (stops the Surfnet, the
indexer, and the local Postgres instance).

Or, for a single command that does the whole thing end to end, run
`npm run dev:all` — it runs `setup:dev`, then starts `npm run dev`, and on
Ctrl-C (or any exit) automatically runs `teardown:dev` for you, so surfpool
and local Postgres never linger after you're done. See `app/scripts/dev-all.sh`.

### Useful scripts

Runnable from the repo root or from `app/` — identical either way.

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run setup:dev` | One-shot full local dev env setup (surfpool + airdrops + deploy + NEB launch + indexer, which applies the DB schema itself) |
| `npm run teardown:dev` | Stop surfpool, the indexer, and local Postgres started by `setup:dev` |
| `npm run dev:all`   | `setup:dev` + `dev` in one command; Ctrl-C runs `teardown:dev` automatically |
| `npm run dev`       | Start the dev server                        |
| `npm run build`     | Production build — no DB schema/client involved, the indexer owns that entirely |
| `npm run test`      | Run unit tests (pure logic only — no database needed)  |
| `npm run typecheck` | Type-check without emitting (needs `anchor build` first) |
| `npm run lint`       | ESLint |
| `npm run test:anchor` | Run the Anchor program's Rust test suite |
| `npm run settle:epoch` | Manual revenue settlement run (AdSense → on-chain reward funding) |
| `npm run snapshot:daily` | Write today's `AppStatsSnapshot` row per app (for trend charts) |
| `npm run launch:neb` | Mint NEB's full supply and seed the NEB/USDC Meteora DLMM pool (see below) |
| `npm run apps:create-onchain` | Register every app in `scripts/appData/apps.json` on-chain (idempotent — see "Populating apps" below) |
| `npm run apps:discover -- --tag=<tag>` | Use `claude -p` to find real apps matching a tag and append them to `scripts/appData/apps.json` |

## Populating apps

There is no database seed script (see "Database ownership" below) — apps
only exist once a real `init_app` transaction confirms on-chain and the
indexer picks it up. `scripts/appData/apps.json` is a checked-in list of
`{url, name, tagline, description, category, chain, tags}` entries (seeded
from ~30 well-known Solana apps, then expanded with `apps:discover` — see
below); `npm run apps:create-onchain` sends one real, permissionless
`init_app` (+ `suggest_tag` per initial tag) transaction per entry, signed
by a local keypair (`~/.config/solana/id.json` by default, or
`DEPLOYER_KEYPAIR_PATH`) — the exact same instructions the app's own
"Create app" UI flow builds, just scripted. It's idempotent (the on-chain
`app_id` is derived deterministically from each entry's URL, so a second
run only creates whatever's still missing), so it's safe to run on every
`setup:dev` (which does — see `app/scripts/setup-dev.sh`) and safe to
re-run against a production deployment as the list grows.

There's no automated production/deploy step for this in `render.yaml` — it
needs a funded keypair with real SOL, which isn't something to hand to an
automatic Render build. Run it manually against a deployment instead:

```bash
DEPLOYER_KEYPAIR_PATH=/path/to/funded-keypair.json \
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID=<deployed program id> \
npm run apps:create-onchain
```

To grow the list beyond its current apps (including into non-Solana
categories — `chain` supports `web2`/`ethereum`/etc., not just `solana`),
run `npm run apps:discover -- --tag=<tag>` for whatever tag/category you
want more coverage of; it shells out to a local `claude -p` subprocess
(same pattern as the deleted `seed-live/tagger.ts` used to tag apps, just
inverted — see `scripts/discoverApps.ts`) asking for real apps matching
that tag, dedupes against the existing list by URL, and appends whatever's
new.

## NEB token launch

NEB isn't minted or sold by the Anchor program — `app/scripts/launch-neb/`
mints the full configured supply with on-chain Metaplex metadata, then
creates a NEB/USDC Meteora DLMM pool and seeds it single-sided with that
entire supply, so buying NEB is a direct swap against a public pool rather
than an instruction on our own program.

`npm run setup:dev` runs this automatically against your local surfpool
Surfnet (real mainnet USDC, real DLMM/Metaplex programs, no manual account
cloning) the first time it's run, and writes the resulting mint/pool
addresses into `app/.env` — skipped on later runs if they're already set.

For a one-off or production launch, run it directly: copy
`app/scripts/launch-neb/launch-neb.config.example.jsonc` to
`launch-neb.config.json` in that same directory, fill in the token/pool
parameters, and run `npm run launch:neb` (defaults to a dry run — set
`"dryRun": false` once you've reviewed the plan it prints). The deployer
wallet needs a small nonzero balance of the quote token (any amount) before
running for real — the DLMM program rejects pool creation from a wallet
holding only the freshly minted base token. Set the printed mint and pool
addresses as `NEXT_PUBLIC_VOTE_TOKEN_MINT` and `NEXT_PUBLIC_NEB_DLMM_POOL`
afterward.

## Simulation vs on-chain mode

Set `NEXT_PUBLIC_VOTE_TOKEN_MINT` to a real SPL mint (and deploy the Anchor
program) to run **on-chain**: votes and stakes require confirmed Solana
transactions. Leave it blank to run in **simulation mode** — the same flows are
recorded off-chain so most of the product can be exercised without a funded
wallet. See `app/src/lib/config.ts`.

App/tag creation is the one flow that's always real, in both modes: `init_app`/
`suggest_tag` never touch the vote-token mint, so "Create app" always builds,
signs, and submits a genuine on-chain transaction — there's no off-chain
fallback (see "Database ownership" below).

## Database ownership

The indexer (`indexer/`), not the app, owns the Postgres schema and is the
only writer of `App`/`Tag`/`AppTag` rows — see root `AGENTS.md` for the full
explanation. Practically, this means: there is no seed script; `npm run dev`
alone against a brand-new database serves an empty product until the indexer
has run at least once (it applies the schema itself on startup, see
`indexer/src/db.rs`) and something real happens on-chain for it to index.
`npm run setup:dev`/`dev:all` handle this for local dev automatically.

## Architecture

- `app/src/lib/ranking.ts` — pure ranking math (weights, freshness decay).
- `app/src/lib/revenue.ts` — pure revenue-split math (stake-proportional).
- `app/src/lib/engine.ts` — bridges the pure math to the database (aggregate
  refresh, epoch settlement).
- `app/src/app/api/**` — REST API (apps, tags, votes, stakes, tracking, ads, auth).
- `indexer/src/processors/product.rs` — populates `App`/`Tag`/`AppTag` from
  confirmed on-chain `init_app`/`suggest_tag` instructions.
- `programs/nebulous_world` — the on-chain Anchor program.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.
