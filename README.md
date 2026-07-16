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

### Useful scripts

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Start the dev server                        |
| `npm run build`     | Production build (runs `prisma generate`)   |
| `npm run db:push`   | Sync Prisma schema to the DB                |
| `npm run db:seed`   | Seed demo apps / votes / stakes / traffic   |
| `npm run db:reset`  | Force-reset the DB and re-seed              |
| `npm run db:studio` | Open Prisma Studio                          |
| `npm run test`      | Run unit tests (ranking / revenue math)     |
| `npm run typecheck` | Type-check without emitting                 |

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
