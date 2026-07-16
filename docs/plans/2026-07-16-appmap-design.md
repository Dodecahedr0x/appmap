# AppMap Design

Status: validated design, not yet implemented beyond the existing scaffold.
Date: 2026-07-16

## 1. Overview & core mechanics

AppMap is a crowd-sourced directory of apps with token-weighted discovery and
ad-revenue sharing. Three actions drive it:

- **Submit an app** — anyone can list an app (name, URL, description,
  category, chain). It is listed immediately, starting with zero rank weight
  (see [Moderation](#5-traffic-tracking-anti-fraud--moderation)).
- **Vote (= stake on the app directly)** — a user locks vote-tokens to an
  app. This is withdrawable at any time, not a one-time spend. While locked
  it (a) weights the app's rank score and (b) entitles the voter to a share
  of that app's ad revenue. This is functionally "staking on the app
  itself" — the same mechanism as tag staking, just scoped to the app
  rather than a tag.
- **Suggest & stake a tag** — anyone can propose a tag for an app; anyone
  (including the proposer) can then stake tokens behind that specific
  app-tag pairing. Stake weights how strongly the tag applies (for
  search/filtering) and entitles the staker to a share of that tag's cut of
  the app's ad revenue.

Both vote-positions and tag-stake-positions are withdrawable: pulling tokens
out removes their ranking weight and forfeits *future* (not past) revenue
share.

This collapses what looked like two separate schema concepts (`Vote`,
`Stake`) into one shared mechanic at two scopes (app-level vs. tag-level),
keeping the code path — lock, withdraw, earn — identical for both. The
existing Prisma schema already models this closely; the main change needed
is adding withdrawal fields (`active`, `withdrawnAt`) to the `Vote` model to
match `Stake`.

## 2. Ranking & revenue math

**Ranking** (already implemented in `src/lib/ranking.ts`, unchanged): each
app's rank score blends four log-dampened signals so no single whale
dominates:

```
score = 1.0·log(1+votes) + 0.8·log(1+tagStake) + 0.35·log(1+traffic)
        + freshnessBonus·decay(age)
```

Freshness gives new apps a fading visibility boost (1.5 bonus, 14-day
half-life). Text search relevance (when there's a query) blends 70/30 with
normalized rank.

**Revenue split** extends the existing `distributeRevenue()` pro-rata
function (`src/lib/revenue.ts`), called twice per app per epoch instead of
once:

1. Take the app's allocated gross revenue for the epoch (see
   [Epoch settlement](#4-epoch-settlement-from-adsense-usd-to-on-chain-claims)).
2. Skim the protocol fee (currently 10%) off the top.
3. Split the remainder 50/50 into an **app pool** (for voters) and a
   **tags pool** (for tag stakers).
4. If the app has zero active tag stake that epoch, the tags pool rolls
   into the app pool instead of sitting undistributed.
5. Within each pool, `distributeRevenue()` splits pro-rata by position
   size, giving the last staker the rounding remainder so nothing is lost
   to float dust (existing behavior, reused unchanged).

No change to `ranking.ts`; `revenue.ts` gains a thin wrapper that calls it
twice with two pool amounts and two position lists (vote positions,
tag-stake positions) instead of once with a merged list.

## 3. On-chain program (Anchor)

The current scaffold's "on-chain mode" (`src/hooks/useTokenTransfer.ts`) is
a plain SPL transfer from the user's wallet to a treasury ATA — custodial:
the platform controls the funds and there is no way to trustlessly track or
withdraw an individual position. A real program with per-position vaults is
needed.

**Accounts (PDAs):**

- `Config` — one global account: authority, vote-token mint, protocol fee
  bps.
- `AppAccount` (seeds: `["app", app_id]`) — token vault, `total_vote_stake`,
  `voteAccRewardPerShare` (accumulator), `total_tag_stake`,
  `tagsAccRewardPerShare`.
- `AppTagAccount` (seeds: `["tag", app_id, tag_id]`) — token vault,
  `stake_amount`. Its stake rolls up into the parent `AppAccount`'s
  `total_tag_stake` and `tagsAccRewardPerShare`.
- `VotePosition` / `StakePosition` (seeds keyed by user + app/tag) —
  `amount`, `rewardDebt`.

**Reward mechanism:** the standard "accumulated reward-per-share" pattern
(as used by Synthetix/MasterChef-style staking programs), not per-epoch
snapshots. Each time the treasury funds an app's reward vault, the relevant
accumulator increases by `funded / total_stake_at_that_moment`. A position's
claimable amount is always
`position.amount × accumulator − position.rewardDebt`, recalculated fresh on
every claim/stake/withdraw. Users can stake, withdraw, or claim at any time
without waiting for or reconciling against a frozen epoch snapshot — this is
the well-tested trustless approach for pro-rata streaming rewards.

**Instructions:** `init_app`, `vote` / `withdraw_vote`, `suggest_tag`
(creates `AppTagAccount`), `stake_tag` / `withdraw_tag_stake`,
`fund_app_rewards` (authority-only, called by the platform's epoch job),
`claim_vote_reward`, `claim_tag_reward`.

This is the single largest piece of new engineering in this project.

## 4. Epoch settlement: from AdSense USD to on-chain claims

A scheduled job (weekly) runs the settlement pipeline:

1. **Pull real earnings.** Query the AdSense Management API for the
   period's finalized earnings (AdSense reports lag ~2–3 days for
   finalization, so the epoch boundary should trail "now" by that margin).
2. **Allocate by traffic share.** Using our own tracked,
   CAPTCHA-verified pageviews per app for the period, compute each app's
   `share = appViews / totalViews` and `appGross = totalEarnings × share`.
   This is an allocation model, not exact per-impression truth — label it
   as such anywhere it's shown to users.
3. **Convert to vote-token.** The platform treasury swaps the AdSense USD
   payout for the vote token via an off-chain exchange, at prevailing
   rates. Manual/operational at first; may be automated later.
4. **Split and fund on-chain.** For each app: subtract the protocol fee,
   split 50/50 into app-pool / tags-pool (tags-pool rolls to app-pool if no
   tag stake exists), then call `fund_app_rewards` twice (vote
   accumulator, tags accumulator) with the converted amounts.
5. **Users claim any time.** No claim deadline — the accumulator model
   means a position always reflects exactly what's owed, whenever the user
   claims.

`RevenueEpoch`/`RevenueClaim` remain in the schema but shift role: from "the
source of truth for who's owed what" to an **audit trail** of what was
allocated and funded on-chain each period. The program's accumulator is the
actual source of truth for claimable balances.

**Trust note:** steps 3–4 require trusting the platform to honestly fund
each epoch — the one inherently custodial link in an otherwise trustless
chain, since real-world ad money cannot enter a smart contract by itself.
State this plainly to users.

## 5. Traffic tracking, anti-fraud & moderation

**Pageview tracking** (extends the existing `TrafficBeacon` component +
`/api/track` route + `src/lib/tracking.ts`):

- A visit counts toward *revenue-eligible* traffic only after the visitor
  clears a low-friction CAPTCHA challenge (e.g. Cloudflare Turnstile)
  client-side — the beacon fires only once the token is verified
  server-side. This targets the self-inflation risk directly: faking
  thousands of verified-human pageviews at scale becomes expensive.
- Raw (non-revenue) pageviews still record unchallenged for general
  analytics/traffic charts, flagged `revenueEligible: false` — the site
  doesn't feel gated for casual browsers, only the money-relevant count is
  hardened.
- Existing dedupe (salted visitor id, 30-minute session window) and bot-UA
  filtering remain as an additional layer.
- Schema addition: `revenueEligible Boolean` on `PageView`; the
  traffic-share calculation in settlement step 2 sums only eligible views.
- CAPTCHA is *not* required for voting/staking — the wallet signature
  already required there is itself a strong sybil deterrent (it costs real
  tokens to fake).

**Moderation** (stake-gated, no admin queue):

- New apps and suggested tags go live immediately — searchable,
  submittable, stakeable — with zero rank weight until they earn real
  votes/stake, so spam naturally sinks rather than needing manual triage.
- A lightweight admin-only `flagged` status (already in the `AppStatus`
  enum) hides an app from search/ads entirely for clear abuse (scams,
  illegal content, impersonation) — a manual override, not a gate on normal
  submissions.
- No stake-to-submit friction; submission stays free, only visibility is
  earned.

## 6. Search & visualization

Builds on the existing `Discover`/`Facets`/`Sparkline` components:

- **Sort/filter panel** — facets for category, tag, chain (existing) plus
  sort options: rank (default), votes, tag-stake, traffic, newest. Filters
  and sort compose.
- **Trend charts** — extend `Sparkline` into a per-app history view on the
  app detail page (daily/weekly series for votes, tag-stake, traffic).
  Requires a new lightweight `AppStatsSnapshot` table (appId, date,
  voteWeight, stakeTotal, viewCount) written once per day by a cron job,
  since current data is only cumulative counters.
- **Tag relationship explorer** — a bubble/force-graph view where tags are
  nodes sized by total stake across all apps, with edges/proximity
  reflecting co-occurrence (tags frequently appearing together on the same
  apps). A discovery path other than search-by-keyword.

All three build incrementally on existing code; no data model changes
beyond the new snapshot table.

## 7. Phasing & open risks

**Suggested phasing** (each phase independently shippable/testable):

1. **Verify the existing scaffold** — install deps, configure `.env`, push
   + seed the DB, run the app, fix whatever surfaces. No new design here,
   just closing the gap that stalled the prior session.
2. **Off-chain model updates** — add `Vote.active`/`withdrawnAt`,
   `PageView.revenueEligible`, `AppStatsSnapshot`; extend `revenue.ts` to
   the two-pool split; unit tests for both.
3. **Anchor program** — the biggest single lift: accounts, instructions,
   devnet deploy, replacing the current plain-transfer `useTokenTransfer`
   hook with real program calls.
4. **Traffic hardening** — CAPTCHA-gated revenue-eligible pageviews.
5. **AdSense settlement pipeline** — buildable and testable against mocked
   earnings data well before there's real traffic to reconcile against.
6. **Search & visualization additions** — trend charts, tag explorer.

**Open risks:**

- **AdSense policy exposure** — redistributing ad revenue to third parties
  based on traffic is adjacent to territory AdSense's program policies
  restrict (incentivized viewing, revenue arbitrage). Needs a policy
  review before launch.
- **Custodial trust at epoch funding** — the fiat→token bridge (section 4)
  is inherently manual/trusted; document it plainly rather than implying
  full trustlessness.
- **Anchor program security** — it will hold real user funds; warrants an
  independent security review before mainnet.
- **Traffic allocation is approximate**, not exact per-impression truth —
  label it as such in the UI.
