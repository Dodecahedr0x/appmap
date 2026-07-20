# Gamification: XP & Levels — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation

## 1. Overview & goals

**Feature:** an XP & Levels system for nebulous.world, aimed at daily engagement/retention.

**Core loop:** users earn XP for meaningful on-chain contributions (submitting apps, suggesting tags, voting, staking) plus a small daily bonus for their first action each day. XP accumulates into a level with a cosmetic title/badge — no economic effects, no fee discounts, no vote-weight boosts. It's purely status: a number and a badge that says "this wallet has been here, contributing, for a while."

**Why cosmetic-only:** Nebulous already has real token-economics (vote weight, stake, revenue share). Layering XP-based functional perks on top would blur "you have influence because you have capital" with "you have influence because you level up" — a fairness/tokenomics risk this pass deliberately avoids. Cosmetic status still satisfies the retention goal (Duolingo streaks, GitHub contribution graphs, Stack Overflow reputation all work without functional advantage).

**Fairness:** XP is flat per action (not scaled by token amount), so a small-wallet daily participant can out-level a whale who votes once with a huge stake — this system rewards *showing up*, not *capital*.

**Surface:** a new `/profile` page (level, XP bar, badge, activity history) plus a small level badge next to the connected wallet in the navbar, linking to the profile. No changes to `AppCard`, `Leaderboard`, or `ForceMap` in this pass.

## 2. XP sources, amounts & anti-farming

| Action | XP | Rule |
|---|---|---|
| Submit a new app (`init_app`) | 100 | Every submission counts — no cap |
| Suggest a tag (`suggest_tag`) | 40 | Every suggestion counts |
| Vote on an app (`vote`) | 20 | **First vote per (wallet, app) pair only** |
| Stake on a tag (`stake_tag`) | 30 | **First stake per (wallet, tag) pair only** |
| Daily bonus | 15 | First XP-earning action of the UTC day, on top of that action's own XP |

**Anti-farming:** vote/stake XP is granted once per unique `(wallet, target)` pair, permanently — not tied to whether a position is currently open. Withdrawing and re-voting/re-staking on the same target grants no additional XP. Voting/staking on a *different* target always earns XP normally — this rewards broad participation, not repetition.

Submitting apps and suggesting tags don't need this guard — each submission/suggestion is inherently a new target.

**Daily bonus:** tracked via "has this wallet earned any XP today (UTC)?" The first qualifying action of the day adds +15 on top of its own XP; subsequent actions that day earn only their base XP. No streak multiplier in this pass.

**Withdraw/claim actions grant no XP:** `withdraw_vote`, `withdraw_tag_stake`, `claim_vote_reward`, `claim_tag_reward` are not XP sources. Withdrawing doesn't claw back previously-earned XP either — XP is permanent once granted, reflecting "you did this at some point," not current position size.

## 3. Level curve & titles/badges

**Curve:** cumulative XP required for level `n` is `50 * n * (n + 1)` (triangular growth):

| Level | Cumulative XP | XP from prior level |
|---|---|---|
| 1 | 0 | — |
| 2 | 100 | 100 |
| 3 | 300 | 200 |
| 4 | 600 | 300 |
| 5 | 1000 | 400 |
| 10 | 5500 | 900 |
| 20 | 21000 | 1900 |

No level cap; the formula keeps extending indefinitely.

**Titles:**

| Level range | Title |
|---|---|
| 1–4 | Newcomer |
| 5–9 | Regular |
| 10–19 | Contributor |
| 20–29 | Curator |
| 30–49 | Tastemaker |
| 50+ | Signal |

**Badge rendering:** a small `Indigo Soft`-background pill (reusing the existing `.chip` token language from DESIGN.md) showing `Lv {n} · {title}` — matches the app's existing tag-chip visual language, no fantasy/trophy styling.

## 4. Data model & indexer changes

All new state lives in the indexer's Postgres schema (Rust/`sqlx` migrations) — the Next.js app has no direct DB client.

**New migration (`indexer/migrations/006_gamification.sql`):**

```sql
ALTER TABLE "User" ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN last_xp_day DATE; -- UTC date of last XP-earning action, for daily bonus

CREATE TABLE "XpEvent" (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "User"(id),
  kind TEXT NOT NULL,          -- 'submit_app' | 'suggest_tag' | 'vote' | 'stake' | 'daily_bonus'
  target_id TEXT,              -- app id / tag id; NULL for daily_bonus
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforces "first vote/stake per (wallet, target) only" for kind IN ('vote','stake')
CREATE UNIQUE INDEX xp_event_unique_target
  ON "XpEvent" (user_id, kind, target_id)
  WHERE kind IN ('vote', 'stake');
```

`level` and `title` are pure functions of `xp` (Section 3's formula), computed on read — not stored — to avoid drift between stored and derived values. `User.xp` remains a running counter, updated transactionally alongside each `XpEvent` insert (not lazily summed on read).

**Indexer handler changes:** in the existing handlers that upsert `Vote`/`Stake`/`App`/`Tag` rows on confirmed instructions (`indexer/src/handlers/`), after a successful domain-row write, insert into `XpEvent`. For `vote`/`stake`, use `ON CONFLICT DO NOTHING` against the partial unique index — a conflict means no XP was granted, so skip the `User.xp` update. For `submit_app`/`suggest_tag`, always insert. After any successful insert, check whether `last_xp_day` for that user is today (UTC); if not, also insert a `daily_bonus` `XpEvent` and update `last_xp_day`. Increment `User.xp` by the total granted for that instruction.

**Backfill:** a one-time migration script walks existing `Vote`/`Stake`/`App`/`Tag` rows and inserts corresponding `XpEvent`s (respecting the same unique-per-target rule), so existing users don't start at 0 XP when this ships.

## 5. API & app-side surfacing

**Indexer API:** extend/add an endpoint (e.g. `GET /api/users/:wallet/xp`) returning:

```json
{
  "xp": 740,
  "level": 4,
  "title": "Newcomer",
  "currentLevelXp": 600,
  "nextLevelXp": 1000,
  "progress": 0.35,
  "recentEvents": [
    { "kind": "vote", "targetId": "app_123", "amount": 20, "createdAt": "..." },
    { "kind": "daily_bonus", "amount": 15, "createdAt": "..." }
  ]
}
```

Level/title/progress computed server-side from the Section 3 formula, kept in one place.

**App changes (`app/src/lib/indexerClient.ts`):** add a client method for the new endpoint, following the existing pattern used for rewards positions.

**New `/profile` page** (`app/src/app/profile/page.tsx`, gated on connected wallet):
- Header: level badge (`Lv {n} · {title}` chip) + XP progress bar to next level (tabular-nums).
- Activity feed: reverse-chronological `recentEvents`, each resolved to a display name via existing app/tag lookups (e.g. as used in `AppCard`) — "Voted on {app name}", "Suggested tag {tag name}", "Staked on {tag name}", "Submitted {app name}", "Daily bonus" — with XP amount and timestamp.
- Lifetime stats row: apps submitted, tags suggested, apps voted on, tags staked (counts by `XpEvent` kind).

**Navbar change (`Navbar.tsx`):** small `Lv {n}` chip next to the existing wallet/NEB-balance display, linking to `/profile`. Uses the same `Indigo Soft` chip token.

## 6. Edge cases & rollout considerations

- **Retroactive XP:** backfill script required (Section 4) so existing active users and dev-seeded data aren't reset to 0.
- **Timezone for daily bonus:** UTC day boundary via `last_xp_day DATE` — simplest, no per-user timezone tracking.
- **Concurrency:** the partial unique index makes vote/stake XP grants race-safe — concurrent indexer workers processing overlapping instructions for the same (wallet, target) will have one insert succeed and one conflict, so `User.xp` increments exactly once.
- **No level cap, no decay:** XP never decreases, levels never cap — reflects lifetime contribution, not a seasonal ladder. A seasonal/reset system would be a separate future feature.
- **Out of scope for this pass:** streak mechanics, functional perks, badges beyond the level title, and surfacing on leaderboard/app cards.
