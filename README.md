# AppMap

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
- 📊 **Analytics** — dashboards for rankings, vote/stake distribution, traffic
  trends, and revenue flows.

## Tech stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript               |
| Styling    | Tailwind CSS                                        |
| Database   | Prisma ORM + SQLite (dev) / Postgres (prod)         |
| Wallet     | `@solana/wallet-adapter` (Phantom, Solflare, …)     |
| Auth       | Sign-In-With-Solana (ed25519 signature, no passwords) |
| Charts     | Recharts                                            |
| On-chain   | Anchor program (`programs/appmap`) for vote/stake/revenue |

## Getting started

```bash
npm install
cp .env.example .env          # tweak if needed
npm run db:reset              # push schema + seed demo data
npm run dev                   # http://localhost:3000
```

This runs the product in **simulation mode** (see below) — no Solana
toolchain required. To exercise the real on-chain program (or before running
`npm run typecheck`/`npm run build`, both of which import the program's
generated IDL/types), you first need:

```bash
anchor build                  # generates target/idl/appmap.json + target/types/appmap.ts
solana-test-validator          # in a separate terminal — devnet's public RPC is currently
                                # unreliable for program deploys, see Anchor.toml
anchor deploy --provider.cluster localnet
```

then set `NEXT_PUBLIC_APPMAP_PROGRAM_ID` and `NEXT_PUBLIC_VOTE_TOKEN_MINT` in
`.env` to the deployed program id and a real SPL mint.

Or run all of the above (install, `.env`, `anchor build`, a local validator,
program deploy, and `db:reset`) in one shot with `npm run setup:dev` — see
`scripts/setup-dev.sh`. It requires the Solana/Anchor toolchain and leaves the
validator running in the background for `npm run dev` to talk to.

### Useful scripts

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run setup:dev` | One-shot full local dev env setup (validator + deploy + db) |
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

## Simulation vs on-chain mode

Set `NEXT_PUBLIC_VOTE_TOKEN_MINT` to a real SPL mint (and deploy the Anchor
program) to run **on-chain**: votes and stakes require confirmed Solana
transactions. Leave it blank to run in **simulation mode** — the same flows are
recorded off-chain so the entire product can be exercised without a funded
wallet. See `src/lib/config.ts`.

## Architecture

- `src/lib/ranking.ts` — pure ranking math (weights, freshness decay).
- `src/lib/revenue.ts` — pure revenue-split math (stake-proportional).
- `src/lib/engine.ts` — bridges the pure math to the database (aggregate
  refresh, epoch settlement).
- `src/app/api/**` — REST API (apps, tags, votes, stakes, tracking, ads, auth).
- `programs/appmap` — the on-chain Anchor program.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.
