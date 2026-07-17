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
| Database   | Prisma ORM + Postgres                               |
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

```bash
cd app && npm install && cd ..  # one-time: install the app's own deps
cp app/.env.example app/.env    # tweak if needed
npm run db:reset                # push schema + seed demo data
npm run dev                     # http://localhost:3000
```

`db:reset` (and `db:push`/`test`) auto-provisions a local Postgres via
Homebrew the first time you run them — installs `postgresql@15` if missing,
starts it, and creates the `nebulous_world_dev`/`nebulous_world_test` role and database (see
`app/scripts/ensure-postgres.sh`). Point `DATABASE_URL` at your own instance
instead if you'd rather manage Postgres yourself.

This runs the product in **simulation mode** (see below) — no Solana
toolchain required. To exercise the real on-chain program (or before running
`npm run typecheck`/`npm run build`, both of which import the program's
generated IDL/types), you first need, from the repo root:

```bash
anchor build                  # generates target/idl/nebulous_world.json + target/types/nebulous_world.ts
surfpool start --network mainnet --airdrop-keypair-path ~/.config/solana/id.json
                                # in a separate terminal — forks mainnet, so real
                                # programs (DLMM, Metaplex) and mints (USDC) are
                                # fetched on demand, no manual account cloning
anchor deploy --provider.cluster localnet
```

then set `NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID` in `app/.env` to the deployed
program id, and run `npm run launch:neb` (see below) to mint NEB and set
`NEXT_PUBLIC_VOTE_TOKEN_MINT`/`NEXT_PUBLIC_NEB_DLMM_POOL`.

Or run all of the above (install, `.env`, `anchor build`, a local surfpool
Surfnet with SOL + USDC airdropped to your dev keypair, program deploy, the
NEB launch, and `db:reset`) in one shot with `npm run setup:dev` — see
`app/scripts/setup-dev.sh`. It requires the Solana/Anchor toolchain and
[surfpool](https://surfpool.run) (`curl -sL https://run.surfpool.run/ | bash`),
and leaves the Surfnet running in the background for `npm run dev` to talk
to. Wind everything back down with `npm run teardown:dev` (stops the
Surfnet and the local Postgres instance).

### Useful scripts

Runnable from the repo root or from `app/` — identical either way.

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run setup:dev` | One-shot full local dev env setup (surfpool + airdrops + deploy + NEB launch + db) |
| `npm run teardown:dev` | Stop surfpool and local Postgres started by `setup:dev` |
| `npm run dev`       | Start the dev server                        |
| `npm run build`     | Production build (runs `prisma generate`)   |
| `npm run db:push`   | Sync Prisma schema to the DB                |
| `npm run db:seed`   | Seed demo apps / votes / stakes / traffic   |
| `npm run db:reset`  | Force-reset the DB and re-seed              |
| `npm run db:studio` | Open Prisma Studio                          |
| `npm run test`      | Run unit tests                              |
| `npm run typecheck` | Type-check without emitting (needs `anchor build` first) |
| `npm run lint`       | ESLint |
| `npm run test:anchor` | Run the Anchor program's Rust test suite |
| `npm run settle:epoch` | Manual revenue settlement run (AdSense → on-chain reward funding) |
| `npm run snapshot:daily` | Write today's `AppStatsSnapshot` row per app (for trend charts) |
| `npm run launch:neb` | Mint NEB's full supply and seed the NEB/USDC Meteora DLMM pool (see below) |

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
recorded off-chain so the entire product can be exercised without a funded
wallet. See `app/src/lib/config.ts`.

## Architecture

- `app/src/lib/ranking.ts` — pure ranking math (weights, freshness decay).
- `app/src/lib/revenue.ts` — pure revenue-split math (stake-proportional).
- `app/src/lib/engine.ts` — bridges the pure math to the database (aggregate
  refresh, epoch settlement).
- `app/src/app/api/**` — REST API (apps, tags, votes, stakes, tracking, ads, auth).
- `programs/nebulous_world` — the on-chain Anchor program.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.
