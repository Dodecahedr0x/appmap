# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share the same surface, neither secondary:

- **Casual app-discovery visitors** — browsing/searching apps by tag, category, or chain, reading rankings and app pages, with no assumed crypto fluency.
- **Crypto-native Solana users** — connect a wallet (Sign-In-With-Solana), vote and stake NEB tokens behind apps/tags they believe in, and earn ad-revenue share proportional to their stake.

The UI must work for a first-time browsing visitor and an active staker at once — voting/staking can't be buried behind a page built only for skimming, and skimming can't require understanding staking mechanics.

A separate, secondary audience is third-party/agent consumers of the [x402](https://www.x402.org)-priced Data API (`/api/data/*`) — developers paying per request in NEB, not human visitors of the main product.

## Product Purpose

nebulous.world is a crowd-sourced Solana app directory. It ranks apps with a transparent formula blending token-weighted votes, stake, traffic, and freshness decay; ad revenue from app pages is distributed to an app's/tag's stakers proportional to their stake. Success is a public leaderboard of app quality/traction that stays legible at a glance and hard to game, with real economic participation (staking, revenue share) as the loop that keeps it honest over time.

## Positioning

Unlike an editorially curated directory or an opaque algorithmic ranking, every input to nebulous.world's ranking (votes, stake, traffic, freshness) and every revenue distribution is real, verifiable on-chain activity. Staking isn't just a vote — it's an investment that earns actual ad-revenue share, so the incentive to game or abandon a ranking is priced in rather than assumed away. The product also resells its ranking/activity data programmatically via the x402-priced Data API, a distinct monetization surface from the human-facing app.

## Operating Context

Next.js web app; auth is Sign-In-With-Solana (ed25519 signature, no passwords). Runs in two modes that must both fully work:

- **Simulation mode** (no funded wallet / vote-token mint configured) — votes and stakes are recorded off-chain so the product is usable without a funded wallet.
- **On-chain mode** — votes/stakes require confirmed Solana transactions with a real SPL token.

"Create app" is always a real on-chain transaction in both modes — there is no off-chain fallback for app/tag creation. A separate indexer service owns all data and the only path to Solana RPC; the app itself has no direct database or RPC connection.

## Capabilities and Constraints

- Discover/browse apps via tag, category, and chain facets.
- Vote: token-weighted, feeds directly into ranking.
- Tags & staking: anyone can suggest a tag; users stake NEB behind tags they believe in; stake boosts ranking and earns revenue share.
- Ad-revenue sharing: app-page traffic serves ads; revenue distributes to stakers proportional to stake, settled per epoch.
- Explore: platform stats, a similar-apps map, and a tag map (force-directed "Map view," secondary to the Leaderboard).
- Data API: x402-priced, per-request-in-NEB endpoints for third-party/agent consumers, distinct from the free UI-facing API.
- Constraint: every user-facing flow must remain usable in simulation mode — never design something that degrades or breaks without a funded wallet.
- Terminology: NEB (the vote/stake token), vote vs. stake (distinct actions), epoch settlement, x402.

## Brand Commitments

Name: "nebulous.world". Token ticker: NEB. No further binding brand/voice constraints beyond the visual system recorded in DESIGN.md.

## Evidence on Hand

Pre-launch / early stage. The app catalog is a checked-in seed list (~30 well-known apps, expanded via `apps:discover`/`apps:curate` tooling); votes, stakes, and traffic recorded so far are primarily from setup and testing, not real outside users yet. Future work must not fabricate user counts, testimonials, case studies, or press coverage — none exist yet.

## Product Principles

1. Serve the casual browser and the active staker on the same page — voting/staking lives on the card, not gated behind a detail page or crypto-fluency.
2. Keep rankings legible as *why*, not just *what* — a visitor should be able to see what feeds a number (votes, stake, traffic, freshness), not just be told to trust it.
3. Every flow must work with zero funded wallet — simulation mode is a first-class path, not a degraded one.
4. Never imply traction that isn't real — no invented counts, testimonials, or "trending" claims ahead of actual evidence.
5. Keep the x402 Data API's developer/agent-facing concerns (pricing tables, endpoint docs) out of the human-facing product surface.

## Accessibility & Inclusion

WCAG 2.1 AA is the general target. Positive/Warning/Negative (green/amber/red) semantic colors are used for gains, losses, and status — color must never be the sole signal; pair with icons, text, or sign for colorblind users.
