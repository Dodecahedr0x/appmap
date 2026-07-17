# AppMap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the validated design (`docs/plans/2026-07-16-appmap-design.md`) into a working product: withdrawable app/tag staking with a two-pool revenue split, a real Anchor on-chain program backing votes/stakes/claims, CAPTCHA-hardened revenue-eligible traffic tracking, an AdSense-based settlement pipeline, and trend/tag-explorer visualizations.

**Architecture:** Extend the existing Next.js + Prisma scaffold in place rather than rewriting it — most of Phase 2 is additive changes to `src/lib/{revenue,engine,tracking,pageview}.ts` and the Prisma schema. Phase 3 adds a new Anchor workspace at `programs/appmap` and a thin client wrapper that replaces the current plain-SPL-transfer `useTokenTransfer` hook. Phases 4-6 layer on top once the foundation is solid.

**Tech Stack:** Next.js 14 (App Router), Prisma + SQLite, Vitest, `@solana/web3.js`, Anchor (Rust) + `@coral-xyz/anchor` (TS client), Cloudflare Turnstile, AdSense Management API.

**Baseline status (verified before this plan was written):** `npm install`, `prisma db push --force-reset`, `npm run db:seed`, `npm run typecheck`, and `npm run dev` (homepage + `/api/apps` both 200) all work cleanly in the `.worktrees/implement-appmap-design` worktree. `npm run test` currently exits 1 with "no test files found" — Phase 2 fixes this.

---

## Phase 2: Off-chain foundations

### Task 1: Characterization tests for the existing ranking engine

The ranking math in `src/lib/ranking.ts` is pure and already correct, but untested. Lock in its current behavior before touching anything nearby.

**Files:**
- Create: `src/lib/ranking.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from "vitest";
import { computeRankScore, combineSearchScore, ageInDays, RANK_WEIGHTS } from "./ranking";

describe("computeRankScore", () => {
  it("returns the freshness bonus alone for a brand-new app with no activity", () => {
    const score = computeRankScore({ voteWeight: 0, stakeTotal: 0, viewCount: 0, ageDays: 0 });
    expect(score).toBeCloseTo(RANK_WEIGHTS.freshnessBonus, 6);
  });

  it("increases with more votes", () => {
    const low = computeRankScore({ voteWeight: 10, stakeTotal: 0, viewCount: 0, ageDays: 100 });
    const high = computeRankScore({ voteWeight: 1000, stakeTotal: 0, viewCount: 0, ageDays: 100 });
    expect(high).toBeGreaterThan(low);
  });

  it("decays the freshness bonus by half after one half-life", () => {
    const fresh = computeRankScore({ voteWeight: 0, stakeTotal: 0, viewCount: 0, ageDays: 0 });
    const aged = computeRankScore({
      voteWeight: 0,
      stakeTotal: 0,
      viewCount: 0,
      ageDays: RANK_WEIGHTS.freshnessHalfLifeDays,
    });
    expect(aged).toBeCloseTo(fresh / 2, 4);
  });

  it("never goes negative for negative inputs (guards log domain)", () => {
    const score = computeRankScore({ voteWeight: -5, stakeTotal: -5, viewCount: -5, ageDays: 0 });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("combineSearchScore", () => {
  it("returns pure normalized rank when there is no text query", () => {
    expect(combineSearchScore(0, 5, 10)).toBeCloseTo(0.5, 6);
  });

  it("weights text relevance 70% and normalized rank 30% when there is a query", () => {
    const score = combineSearchScore(1, 10, 10);
    expect(score).toBeCloseTo(0.7 * 1 + 0.3 * 1, 6);
  });
});

describe("ageInDays", () => {
  it("computes whole days between two dates", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-04T00:00:00Z");
    expect(ageInDays(start, end)).toBeCloseTo(3, 6);
  });
});
```

**Step 2: Run to verify they pass against the existing implementation**

Run: `npm run test -- ranking.test.ts`
Expected: PASS, 6 tests

**Step 3: Commit**

```bash
git add src/lib/ranking.test.ts
git commit -m "test: characterize the existing ranking engine"
```

---

### Task 2: Characterization tests for the existing revenue engine

Same rationale as Task 1, for `src/lib/revenue.ts`, before it's extended into a two-pool split in Task 4.

**Files:**
- Create: `src/lib/revenue.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from "vitest";
import { distributeRevenue, revenuePerImpression, REVENUE_CONFIG } from "./revenue";

describe("distributeRevenue", () => {
  it("splits pro-rata by stake after taking the protocol fee", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 75 },
      { userId: "b", stake: 25 },
    ]);
    expect(result.protocolFee).toBeCloseTo(10, 6);
    expect(result.distributable).toBeCloseTo(90, 6);
    expect(result.shares.find((s) => s.userId === "a")!.amount).toBeCloseTo(67.5, 6);
    expect(result.shares.find((s) => s.userId === "b")!.amount).toBeCloseTo(22.5, 6);
  });

  it("sums shares to exactly the distributable amount (no rounding dust)", () => {
    const result = distributeRevenue(10, [
      { userId: "a", stake: 1 },
      { userId: "b", stake: 1 },
      { userId: "c", stake: 1 },
    ]);
    const total = result.shares.reduce((sum, s) => sum + s.amount, 0);
    expect(total).toBeCloseTo(result.distributable, 9);
  });

  it("aggregates multiple positions from the same user", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 50 },
      { userId: "a", stake: 50 },
    ]);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]!.amount).toBeCloseTo(90, 6);
  });

  it("returns everything as undistributed when there are no active stakers", () => {
    const result = distributeRevenue(100, []);
    expect(result.shares).toHaveLength(0);
    expect(result.undistributed).toBeCloseTo(90, 6);
  });

  it("ignores zero/negative stake positions", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 10 },
      { userId: "b", stake: 0 },
    ]);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]!.userId).toBe("a");
  });

  it("respects a custom fee rate", () => {
    const result = distributeRevenue(100, [{ userId: "a", stake: 10 }], 0.5);
    expect(result.protocolFee).toBeCloseTo(50, 6);
    expect(result.distributable).toBeCloseTo(50, 6);
  });
});

describe("revenuePerImpression", () => {
  it("divides cpm by 1000", () => {
    expect(revenuePerImpression(REVENUE_CONFIG.protocolFee === 0.1 ? 2.5 : 2.5)).toBeCloseTo(0.0025, 9);
  });
});
```

**Step 2: Run to verify they pass**

Run: `npm run test -- revenue.test.ts`
Expected: PASS, 7 tests

**Step 3: Commit**

```bash
git add src/lib/revenue.test.ts
git commit -m "test: characterize the existing revenue engine"
```

---

### Task 3: Add withdrawal support to votes (schema + migration)

Votes currently have no `active`/`withdrawnAt` fields, unlike `Stake`. Add them so a vote can be withdrawn exactly like a tag stake.

**Files:**
- Modify: `prisma/schema.prisma:109-122` (the `Vote` model)

**Step 1: Edit the schema**

```prisma
model Vote {
  id        String   @id @default(cuid())
  appId     String
  userId    String
  app       App      @relation(fields: [appId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  amount      Float
  txSig       String?  @unique
  createdAt   DateTime @default(now())

  active      Boolean   @default(true)
  withdrawnAt DateTime?

  @@index([appId])
  @@index([userId])
  @@index([active])
}
```

**Step 2: Push the schema and regenerate the client**

Run: `npx prisma db push --force-reset && npm run db:seed`
Expected: schema syncs, seed completes (seed doesn't set `active` explicitly — Prisma's `@default(true)` covers it, so no seed changes needed yet)

**Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add withdrawal fields to Vote, matching Stake"
```

---

### Task 4: `/api/vote/withdraw` route + update `refreshApp` to only count active votes

Mirrors the existing `/api/stake/withdraw` route. `refreshApp` currently sums *all* votes regardless of `active` — that's a live bug the moment Task 3's field exists, since a withdrawn vote would still count.

**Files:**
- Modify: `src/lib/engine.ts:20-24` (the `voteAgg` query inside `refreshApp`)
- Modify: `src/lib/validation.ts` (add `unvoteSchema`)
- Create: `src/app/api/vote/withdraw/route.ts`
- Test: `src/lib/engine.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { refreshApp } from "./engine";

describe("refreshApp", () => {
  let appId: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.vote.deleteMany();
    await prisma.app.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: { wallet: "test-wallet-1" } });
    const app = await prisma.app.create({
      data: { slug: "test-app", name: "Test App", url: "https://example.com" },
    });
    userId = user.id;
    appId = app.id;
  });

  it("excludes withdrawn votes from voteWeight", async () => {
    await prisma.vote.create({ data: { appId, userId, amount: 100, active: true } });
    await prisma.vote.create({ data: { appId, userId, amount: 50, active: false } });

    await refreshApp(appId);

    const app = await prisma.app.findUniqueOrThrow({ where: { id: appId } });
    expect(app.voteWeight).toBe(100);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- engine.test.ts`
Expected: FAIL — `voteWeight` is 150, not 100 (the query doesn't filter by `active` yet)

**Step 3: Fix `refreshApp`**

In `src/lib/engine.ts`, change:

```typescript
    prisma.vote.aggregate({
      where: { appId },
      _sum: { amount: true },
      _count: true,
    }),
```

to:

```typescript
    prisma.vote.aggregate({
      where: { appId, active: true },
      _sum: { amount: true },
      _count: true,
    }),
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- engine.test.ts`
Expected: PASS

**Step 5: Add the withdraw schema**

In `src/lib/validation.ts`, add near `unstakeSchema`:

```typescript
export const unvoteSchema = z.object({
  voteId: z.string().min(1),
});
```

**Step 6: Create the withdraw route**

```typescript
import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { unvoteSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshApp } from "@/lib/engine";

// POST /api/vote/withdraw — withdraw an active vote.
//
// In on-chain mode the program returns the tokens; here we mark the vote
// inactive so it stops boosting rank and earning revenue.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unvoteSchema.parse(await req.json());

  const vote = await prisma.vote.findUnique({ where: { id: body.voteId } });
  if (!vote) throw new ApiError("Vote not found", 404);
  if (vote.userId !== user.id) throw new ApiError("Not your vote", 403);
  if (!vote.active) throw new ApiError("Vote already withdrawn", 409);

  await prisma.vote.update({
    where: { id: vote.id },
    data: { active: false, withdrawnAt: new Date() },
  });

  await refreshApp(vote.appId);

  return ok({ withdrawn: true });
});
```

**Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS, all tests green

**Step 8: Commit**

```bash
git add src/lib/engine.ts src/lib/validation.ts src/lib/engine.test.ts src/app/api/vote/withdraw/route.ts
git commit -m "feat: withdrawable votes (API + active-vote filtering)"
```

---

### Task 5: Two-pool revenue split (`distributeAppRevenue`)

Adds the app/tags 50/50 split from the design doc as a wrapper around the existing `distributeRevenue`, without changing that function.

**Files:**
- Modify: `src/lib/revenue.ts`
- Test: `src/lib/revenue.test.ts` (append)

**Step 1: Write the failing test**

Append to `src/lib/revenue.test.ts`:

```typescript
import { distributeAppRevenue } from "./revenue";

describe("distributeAppRevenue", () => {
  it("splits the distributable amount 50/50 between vote and tag pools", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [{ userId: "voter", stake: 10 }],
      tagPositions: [{ userId: "tagger", stake: 10 }],
    });
    // fee 10% of 200 = 20, distributable 180, split 90/90
    expect(result.votePool.distributable).toBeCloseTo(90, 6);
    expect(result.tagPool.distributable).toBeCloseTo(90, 6);
  });

  it("rolls the tags pool into the vote pool when there are no tag stakers", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [{ userId: "voter", stake: 10 }],
      tagPositions: [],
    });
    expect(result.votePool.distributable).toBeCloseTo(180, 6);
    expect(result.tagPool.shares).toHaveLength(0);
  });

  it("rolls the vote pool into the tags pool when there are no voters", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [],
      tagPositions: [{ userId: "tagger", stake: 10 }],
    });
    expect(result.tagPool.distributable).toBeCloseTo(180, 6);
  });

  it("retains everything as undistributed when there is neither a voter nor a tagger", () => {
    const result = distributeAppRevenue(200, { votePositions: [], tagPositions: [] });
    expect(result.votePool.undistributed + result.tagPool.undistributed).toBeCloseTo(180, 6);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm run test -- revenue.test.ts`
Expected: FAIL — `distributeAppRevenue` is not exported

**Step 3: Implement it**

Add to `src/lib/revenue.ts`, after `distributeRevenue`:

```typescript
export const APP_TAG_SPLIT = 0.5;

export interface AppRevenueSplit {
  votePool: DistributionResult;
  tagPool: DistributionResult;
}

/**
 * Split an app's gross ad revenue between its direct (vote) stakers and its
 * tags' stakers. The protocol fee is taken once, up front, on the combined
 * gross — then the remainder is split 50/50 between the two pools. If one
 * side has no active positions, its half rolls into the other side instead
 * of being stranded.
 */
export function distributeAppRevenue(
  gross: number,
  positions: { votePositions: StakePosition[]; tagPositions: StakePosition[] },
  feeRate: number = REVENUE_CONFIG.protocolFee,
): AppRevenueSplit {
  const safeGross = Math.max(0, gross);
  const fee = round(safeGross * clamp(feeRate, 0, 1), 9);
  const distributable = round(safeGross - fee, 9);

  const hasVoters = positions.votePositions.some((p) => p.stake > 0);
  const hasTaggers = positions.tagPositions.some((p) => p.stake > 0);

  let voteShare = round(distributable * APP_TAG_SPLIT, 9);
  let tagShare = round(distributable - voteShare, 9);

  if (!hasTaggers) {
    voteShare = distributable;
    tagShare = 0;
  } else if (!hasVoters) {
    tagShare = distributable;
    voteShare = 0;
  }

  // distributeRevenue applies its own fee internally; pass feeRate=0 since the
  // fee was already taken above on the combined gross.
  const votePool = distributeRevenue(voteShare, positions.votePositions, 0);
  const tagPool = distributeRevenue(tagShare, positions.tagPositions, 0);

  return { votePool, tagPool };
}
```

**Step 4: Run to verify it passes**

Run: `npm run test -- revenue.test.ts`
Expected: PASS, all tests including the 4 new ones

**Step 5: Commit**

```bash
git add src/lib/revenue.ts src/lib/revenue.test.ts
git commit -m "feat: two-pool (app/tags) revenue split"
```

---

### Task 6: `PageView.revenueEligible` field

**Files:**
- Modify: `prisma/schema.prisma` (`PageView` model)
- Modify: `src/lib/pageview.ts`

**Step 1: Edit the schema**

In the `PageView` model, add:

```prisma
  revenueEligible Boolean  @default(false)
```

right after `userAgent`. (Default `false` — Task 22 in Phase 4 is what flips a view to `true`, after CAPTCHA verification. Until then, no traffic counts as revenue-eligible, which is correct: there's no fraud-resistant signal yet to trust.)

**Step 2: Push schema**

Run: `npx prisma db push --force-reset && npm run db:seed`
Expected: succeeds. Note the seed script will need updating in Task 9 if it wants seeded views to look revenue-eligible for demo purposes — leave that to Task 9, not here.

**Step 3: Thread the field through `getOrCreatePageView`**

In `src/lib/pageview.ts`, change the signature to accept an optional `revenueEligible` flag (defaulting to `false`) so callers control it explicitly rather than it silently defaulting everywhere:

```typescript
export async function getOrCreatePageView(
  appId: string,
  headers: Headers,
  opts: { path?: string; referrer?: string | null; revenueEligible?: boolean } = {},
): Promise<{ id: string; created: boolean } | null> {
  const v = resolveVisitor(headers);
  if (v.isBot) return null;

  const existing = await prisma.pageView.findFirst({
    where: { appId, visitorId: v.visitorId, sessionId: v.sessionId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const pv = await prisma.pageView.create({
    data: {
      appId,
      visitorId: v.visitorId,
      sessionId: v.sessionId,
      path: opts.path ?? "/",
      referrer: opts.referrer ?? headers.get("referer") ?? null,
      country: headers.get("x-vercel-ip-country") ?? null,
      userAgent: v.userAgent.slice(0, 300),
      revenueEligible: opts.revenueEligible ?? false,
    },
    select: { id: true },
  });
  return { id: pv.id, created: true };
}
```

**Step 4: Verify nothing broke**

Run: `npm run typecheck && npm run test`
Expected: both pass (the `/api/track` route still calls this with no `revenueEligible` opt, which now correctly defaults to `false` until Phase 4 wires up CAPTCHA)

**Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/pageview.ts
git commit -m "feat: add revenueEligible flag to PageView, default false pending CAPTCHA"
```

---

### Task 7: `AppStatsSnapshot` model

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add the model**

```prisma
/// A daily snapshot of an app's cached stats, written by a periodic job.
/// Powers trend charts without needing to reconstruct history from raw
/// votes/stakes/views each time.
model AppStatsSnapshot {
  id         String   @id @default(cuid())
  appId      String
  app        App      @relation(fields: [appId], references: [id], onDelete: Cascade)

  date       DateTime // truncated to the day
  voteWeight Float
  stakeTotal Float
  viewCount  Int
  rankScore  Float

  createdAt  DateTime @default(now())

  @@unique([appId, date])
  @@index([appId])
}
```

Also add the back-relation to `App`:

```prisma
  statsSnapshots AppStatsSnapshot[]
```

**Step 2: Push schema**

Run: `npx prisma db push --force-reset && npm run db:seed`
Expected: succeeds

**Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add AppStatsSnapshot model for trend charts"
```

---

### Task 8: Wire the two-pool split into `settleEpoch`

**Files:**
- Modify: `src/lib/engine.ts` (`settleEpoch`)
- Test: `src/lib/engine.test.ts` (append)

**Step 1: Write the failing test**

Append to `src/lib/engine.test.ts`:

```typescript
import { settleEpoch } from "./engine";

describe("settleEpoch", () => {
  it("distributes gross revenue across both vote and tag pools", async () => {
    await prisma.revenueClaim.deleteMany();
    await prisma.adImpression.deleteMany();
    await prisma.ad.deleteMany();
    await prisma.stake.deleteMany();
    await prisma.appTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.vote.deleteMany();
    await prisma.pageView.deleteMany();
    await prisma.revenueEpoch.deleteMany();
    await prisma.app.deleteMany();
    await prisma.user.deleteMany();

    const voter = await prisma.user.create({ data: { wallet: "voter-1" } });
    const tagger = await prisma.user.create({ data: { wallet: "tagger-1" } });
    const app = await prisma.app.create({
      data: { slug: "settle-app", name: "Settle App", url: "https://example.com" },
    });
    await prisma.vote.create({ data: { appId: app.id, userId: voter.id, amount: 10, active: true } });

    const tag = await prisma.tag.create({ data: { slug: "defi", name: "DeFi" } });
    const appTag = await prisma.appTag.create({ data: { appId: app.id, tagId: tag.id } });
    await prisma.stake.create({ data: { appTagId: appTag.id, userId: tagger.id, amount: 10, active: true } });

    const ad = await prisma.ad.create({ data: { title: "Ad", targetUrl: "https://example.com", cpm: 2.5 } });
    const pv = await prisma.pageView.create({
      data: { appId: app.id, visitorId: "v1", sessionId: "s1", path: "/", revenueEligible: true },
    });
    await prisma.adImpression.create({
      data: { adId: ad.id, appId: app.id, pageViewId: pv.id, revenue: 200 },
    });

    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date(Date.now() + 60_000);
    const epoch = await prisma.revenueEpoch.create({
      data: { appId: app.id, periodStart, periodEnd },
    });

    const result = await settleEpoch(epoch.id);

    expect(result.gross).toBeCloseTo(200, 6);
    expect(result.claims).toBe(2); // one voter claim + one tagger claim

    const voterClaim = await prisma.revenueClaim.findFirst({ where: { userId: voter.id, epochId: epoch.id } });
    const taggerClaim = await prisma.revenueClaim.findFirst({ where: { userId: tagger.id, epochId: epoch.id } });
    // fee 10% of 200 = 20, distributable 180, split 90/90, each pool has one staker taking it all
    expect(voterClaim!.amount).toBeCloseTo(90, 6);
    expect(taggerClaim!.amount).toBeCloseTo(90, 6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- engine.test.ts`
Expected: FAIL — current `settleEpoch` produces a single merged claim per user via `distributeRevenue`, not the 90/90 split from `distributeAppRevenue`

**Step 3: Rewrite `settleEpoch`**

Replace the stake-position-building and distribution portion of `settleEpoch` in `src/lib/engine.ts`:

```typescript
import { distributeAppRevenue, type StakePosition } from "./revenue";

// ... (keep everything above unchanged up to the `gross` calculation)

  const votes = await prisma.vote.findMany({
    where: { appId: epoch.appId, active: true },
    select: { userId: true, amount: true },
  });
  const votePositions: StakePosition[] = votes.map((v) => ({ userId: v.userId, stake: v.amount }));

  const appTags = await prisma.appTag.findMany({
    where: { appId: epoch.appId },
    select: { id: true },
  });
  const stakes = await prisma.stake.findMany({
    where: { appTagId: { in: appTags.map((t) => t.id) }, active: true },
    select: { userId: true, amount: true },
  });
  const tagPositions: StakePosition[] = stakes.map((s) => ({ userId: s.userId, stake: s.amount }));

  const split = distributeAppRevenue(gross, { votePositions, tagPositions });
  const allShares = [...split.votePool.shares, ...split.tagPool.shares];

  await prisma.$transaction(async (tx) => {
    await tx.adImpression.updateMany({
      where: {
        appId: epoch.appId,
        epochId: null,
        createdAt: { gte: epoch.periodStart, lt: epoch.periodEnd },
      },
      data: { epochId: epoch.id },
    });

    for (const share of allShares) {
      await tx.revenueClaim.upsert({
        where: { epochId_userId: { epochId: epoch.id, userId: share.userId } },
        create: { epochId: epoch.id, userId: share.userId, amount: share.amount },
        update: { amount: { increment: share.amount } },
      });
    }

    await tx.revenueEpoch.update({
      where: { id: epoch.id },
      data: { grossRevenue: gross, distributed: true, closedAt: new Date() },
    });
  });

  return { gross, claims: allShares.length };
```

Note the `upsert`'s `update` changed from `{ amount: share.amount }` to `{ amount: { increment: share.amount } }` — this matters if the same user appears in *both* pools (e.g. they both voted and staked a tag on the same app), so their two shares add rather than the second overwriting the first.

**Step 4: Run test to verify it passes**

Run: `npm run test -- engine.test.ts`
Expected: PASS

**Step 5: Run the full suite**

Run: `npm run test && npm run typecheck`
Expected: all green

**Step 6: Commit**

```bash
git add src/lib/engine.ts src/lib/engine.test.ts
git commit -m "feat: settle epochs through the two-pool revenue split"
```

---

### Task 9: Update seed data for the new fields

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Read the current seed script in full to find where votes, stakes, and page views are created**

Run: `grep -n "prisma.vote.create\|prisma.pageView.create\|prisma.stake.create" prisma/seed.ts`

**Step 2: Update it**

- Every `prisma.vote.create` call: no change needed (`active` defaults to `true` via Prisma).
- Every `prisma.pageView.create` call: add `revenueEligible: rand() < 0.7` (roughly 70% of seeded views look CAPTCHA-verified, so the seeded analytics/settlement demo has realistic partial coverage instead of all-or-nothing).
- Add a short block after seeding that creates a few `AppStatsSnapshot` rows for the first 3 apps (last 14 days, using the existing `rand()`/`randInt()` helpers) so the trend chart (Task 30) has something to render out of the box:

```typescript
console.log("📈 Seeding stats snapshots…");
const snapshotApps = await prisma.app.findMany({ take: 3 });
for (const app of snapshotApps) {
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    await prisma.appStatsSnapshot.create({
      data: {
        appId: app.id,
        date,
        voteWeight: app.voteWeight * (1 - daysAgo * 0.03),
        stakeTotal: app.stakeTotal * (1 - daysAgo * 0.02),
        viewCount: Math.round(app.viewCount * (1 - daysAgo * 0.04)),
        rankScore: app.rankScore * (1 - daysAgo * 0.01),
      },
    });
  }
}
```

**Step 3: Run the seed and confirm it completes**

Run: `npm run db:reset`
Expected: completes, prints the existing summary plus no errors from the new snapshot block

**Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore: seed revenueEligible views and demo AppStatsSnapshot rows"
```

---

## Phase 3: Anchor on-chain program

Phase 3 replaces the current custodial plain-SPL-transfer flow (`src/hooks/useTokenTransfer.ts`) with a real Anchor program holding per-position vaults, using the accumulated-reward-per-share pattern described in the design doc. This is the largest and riskiest phase — expect the Rust below to need small compile-time fixes as you go (Anchor macro/version specifics); that's normal iteration, not a sign the design is wrong.

**Prerequisite (one-time, not a plan task):** install the Solana CLI and Anchor CLI (`avm install latest && avm use latest`) if not already present, and configure a devnet keypair with `solana airdrop` for testing.

### Task 10: Scaffold the Anchor workspace

**Files:**
- Create: `programs/appmap/Cargo.toml`
- Create: `programs/appmap/Xargo.toml`
- Create: `programs/appmap/src/lib.rs`
- Create: `Anchor.toml`
- Create: `tests/appmap.ts` (Anchor's TS test harness, separate from Vitest)

**Step 1: Run the Anchor scaffolder**

Run: `anchor init appmap --no-git` from the repo root, then move the generated `programs/appmap`, `Anchor.toml`, `tests/appmap.ts`, and `Cargo.toml`/`Cargo.lock` into place (the scaffolder assumes a fresh directory; merge rather than overwrite `package.json`).

**Step 2: Set the cluster to devnet**

In `Anchor.toml`, set:

```toml
[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
```

**Step 3: Verify it builds**

Run: `anchor build`
Expected: succeeds, produces `target/idl/appmap.json` and a program keypair under `target/deploy/`

**Step 4: Commit**

```bash
git add Anchor.toml Cargo.toml programs/appmap/Cargo.toml programs/appmap/Xargo.toml programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "chore: scaffold the Anchor workspace for the appmap program"
```

**Toolchain note (added after Task 10):** the installed anchor-cli is 1.0.2, which uses `@anchor-lang/core` as its TS client package instead of the `@coral-xyz/anchor` referenced in this plan's original code samples below. The API is compatible (`AnchorProvider`, `Program`, `Wallet`, `BN`, `setProvider`, `workspace` all present) — when implementing Tasks 11+, substitute the import source but keep the same API calls.

---

### Task 11: `Config` account + `initialize` instruction

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1: Write the failing test**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { assert } from "chai";
import { Appmap } from "../target/types/appmap";

describe("appmap: config", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  it("initializes the global config", async () => {
    const mint = await createMint(provider.connection, (provider.wallet as any).payer, provider.wallet.publicKey, null, 6);
    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

    await program.methods
      .initialize(1000) // 10% protocol fee, in bps
      .accounts({ config: configPda, authority: provider.wallet.publicKey, voteMint: mint })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.protocolFeeBps, 1000);
    assert.isTrue(config.voteMint.equals(mint));
  });
});
```

**Step 2: Run to verify it fails**

Run: `anchor test --skip-local-validator=false`
Expected: FAIL — `initialize` doesn't exist

**Step 3: Implement `Config` + `initialize`**

```rust
use anchor_lang::prelude::*;

declare_id!("REPLACE_WITH_ANCHOR_KEYS_LIST_OUTPUT");

pub const REWARD_PRECISION: u128 = 1_000_000_000_000; // 1e12 fixed-point scale

#[program]
pub mod appmap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        require!(protocol_fee_bps <= 10_000, AppmapError::InvalidFeeBps);
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.vote_mint = ctx.accounts.vote_mint.key();
        config.protocol_fee_bps = protocol_fee_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub vote_mint: Account<'info, anchor_spl::token::Mint>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub vote_mint: Pubkey,
    pub protocol_fee_bps: u16,
    pub bump: u8,
}
impl Config {
    pub const SPACE: usize = 32 + 32 + 2 + 1;
}

#[error_code]
pub enum AppmapError {
    #[msg("Protocol fee cannot exceed 100%")]
    InvalidFeeBps,
}
```

**Step 4: Run to verify it passes**

Run: `anchor test`
Expected: PASS

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): Config account + initialize instruction"
```

---

### Task 12: `AppAccount` + `init_app` instruction

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1: Write the failing test**

```typescript
it("initializes an app account with two vaults and zeroed accumulators", async () => {
  const appId = "test-app-id-123";
  const [appPda] = PublicKey.findProgramAddressSync([Buffer.from("app"), Buffer.from(appId)], program.programId);
  const [voteVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vote_vault"), appPda.toBuffer()], program.programId);
  const [voteRewardVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vote_reward_vault"), appPda.toBuffer()], program.programId);
  const [tagsRewardVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("tags_reward_vault"), appPda.toBuffer()], program.programId);

  await program.methods
    .initApp(appId)
    .accounts({
      app: appPda,
      config: configPda,
      voteVault: voteVaultPda,
      voteRewardVault: voteRewardVaultPda,
      tagsRewardVault: tagsRewardVaultPda,
      voteMint: mint,
      payer: provider.wallet.publicKey,
    })
    .rpc();

  const app = await program.account.appAccount.fetch(appPda);
  assert.equal(app.totalVoteStake.toNumber(), 0);
  assert.equal(app.voteAccRewardPerShare.toString(), "0");
});
```

**Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `initApp`/`appAccount` don't exist

**Step 3: Implement**

```rust
use anchor_spl::token::{Mint, Token, TokenAccount};

// inside #[program] mod appmap:
    pub fn init_app(ctx: Context<InitApp>, app_id: String) -> Result<()> {
        require!(app_id.as_bytes().len() <= 32, AppmapError::AppIdTooLong);
        let app = &mut ctx.accounts.app;
        app.app_id = app_id;
        app.vote_vault = ctx.accounts.vote_vault.key();
        app.vote_reward_vault = ctx.accounts.vote_reward_vault.key();
        app.tags_reward_vault = ctx.accounts.tags_reward_vault.key();
        app.total_vote_stake = 0;
        app.vote_acc_reward_per_share = 0;
        app.total_tag_stake = 0;
        app.tags_acc_reward_per_share = 0;
        app.bump = ctx.bumps.app;
        Ok(())
    }

#[derive(Accounts)]
#[instruction(app_id: String)]
pub struct InitApp<'info> {
    #[account(
        init, payer = payer, space = 8 + AppAccount::SPACE,
        seeds = [b"app", app_id.as_bytes()], bump,
    )]
    pub app: Account<'info, AppAccount>,
    pub config: Account<'info, Config>,
    #[account(
        init, payer = payer, seeds = [b"vote_vault", app.key().as_ref()], bump,
        token::mint = vote_mint, token::authority = app,
    )]
    pub vote_vault: Account<'info, TokenAccount>,
    #[account(
        init, payer = payer, seeds = [b"vote_reward_vault", app.key().as_ref()], bump,
        token::mint = vote_mint, token::authority = app,
    )]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(
        init, payer = payer, seeds = [b"tags_reward_vault", app.key().as_ref()], bump,
        token::mint = vote_mint, token::authority = app,
    )]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(address = config.vote_mint)]
    pub vote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct AppAccount {
    pub app_id: String,
    pub vote_vault: Pubkey,
    pub vote_reward_vault: Pubkey,
    pub tags_reward_vault: Pubkey,
    pub total_vote_stake: u64,
    pub vote_acc_reward_per_share: u128,
    pub total_tag_stake: u64,
    pub tags_acc_reward_per_share: u128,
    pub bump: u8,
}
impl AppAccount {
    pub const SPACE: usize = 4 + 32 + 32 + 32 + 32 + 8 + 16 + 8 + 16 + 1;
}
```

Add `AppIdTooLong` to the `AppmapError` enum.

**Step 4: Run to verify it passes**

Run: `anchor test`
Expected: PASS

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): AppAccount + init_app instruction"
```

**Correction note (added after Task 12):** `AppAccount`'s PDA is derived from `[APP_SEED, app_id.as_bytes()]` — the off-chain `app_id` string, not the account's own pubkey. Task 13's `transfer_from_vault` pseudocode below signs CPIs with `seeds: &[&[u8]] = &[b"app", app_key.as_ref(), &[app_bump]]`, which uses the app's pubkey and is **wrong** — signer seeds for `invoke_signed` must exactly match the seeds the PDA was originally derived with, so this must instead be `&[b"app", app.app_id.as_bytes(), &[app.bump]]`. Using `app.key()` in place of `app_id.as_bytes()` compiles fine but fails signature verification at runtime with a confusing error, since the resulting derived address won't match `app`'s actual address. Fix this when implementing Task 13 (and any other task that has the `app` PDA sign a CPI).

---

### Task 13: `VotePosition` + `vote` instruction

Implements the accumulator-pattern deposit: transfer principal in, auto-settle any pending reward (none yet on first vote), update the position.

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1: Write the failing test**

```typescript
it("locks tokens into the vote vault and creates a position", async () => {
  const userAta = await createAssociatedTokenAccount(provider.connection, payer, mint, user.publicKey);
  await mintTo(provider.connection, payer, mint, userAta, payer, 1_000_000_000);

  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote_pos"), appPda.toBuffer(), user.publicKey.toBuffer()],
    program.programId,
  );

  await program.methods
    .vote(new anchor.BN(100_000_000))
    .accounts({ app: appPda, position: positionPda, voteVault: voteVaultPda, voteRewardVault: voteRewardVaultPda, userTokenAccount: userAta, user: user.publicKey })
    .signers([user])
    .rpc();

  const position = await program.account.votePosition.fetch(positionPda);
  assert.equal(position.amount.toNumber(), 100_000_000);

  const vault = await getAccount(provider.connection, voteVaultPda);
  assert.equal(Number(vault.amount), 100_000_000);
});
```

**Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `vote` instruction doesn't exist

**Step 3: Implement**

```rust
use anchor_spl::token::{transfer, Transfer};

    pub fn vote(ctx: Context<Vote>, amount: u64) -> Result<()> {
        require!(amount > 0, AppmapError::ZeroAmount);
        let app = &mut ctx.accounts.app;
        let position = &mut ctx.accounts.position;

        // Auto-settle any pending reward before changing the position size.
        if position.amount > 0 {
            let pending = settle_pending(position.amount, position.reward_debt, app.vote_acc_reward_per_share);
            if pending > 0 {
                transfer_from_vault(
                    &ctx.accounts.vote_reward_vault,
                    &ctx.accounts.user_token_account,
                    &ctx.accounts.app.to_account_info(),
                    &ctx.accounts.token_program,
                    app.key(),
                    app.bump,
                    pending,
                )?;
            }
        }

        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vote_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        position.amount = position.amount.checked_add(amount).ok_or(AppmapError::MathOverflow)?;
        position.owner = ctx.accounts.user.key();
        position.bump = ctx.bumps.position;
        app.total_vote_stake = app.total_vote_stake.checked_add(amount).ok_or(AppmapError::MathOverflow)?;
        position.reward_debt = reward_debt_for(position.amount, app.vote_acc_reward_per_share);
        Ok(())
    }

// Shared helpers, module-level (not inside #[program]):
fn settle_pending(amount: u64, reward_debt: u128, acc_reward_per_share: u128) -> u64 {
    let accrued = (amount as u128 * acc_reward_per_share) / REWARD_PRECISION;
    accrued.saturating_sub(reward_debt) as u64
}

fn reward_debt_for(amount: u64, acc_reward_per_share: u128) -> u128 {
    (amount as u128 * acc_reward_per_share) / REWARD_PRECISION
}
```

`transfer_from_vault` is a small helper that CPIs a token transfer signed by the `AppAccount` PDA (using `seeds = [b"app", app.app_id.as_bytes()], bump = app.bump` as signer seeds) — write it once here since Tasks 14-18 all reuse it:

```rust
fn transfer_from_vault<'info>(
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    app_ai: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    app_key: Pubkey,
    app_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[b"app", app_key.as_ref(), &[app_bump]];
    // NOTE: app_id-based seeds require re-deriving with the stored app_id bytes
    // in the real implementation — see Task 12's seeds. Simplify by signing
    // with the app account's own stored bump against its PDA-derivation seeds.
    transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer { from: vault.to_account_info(), to: to.to_account_info(), authority: app_ai.clone() },
            &[seeds],
        ),
        amount,
    )
}
```

Add `VotePosition` account and `Vote` accounts struct:

```rust
#[account]
pub struct VotePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    pub bump: u8,
}
impl VotePosition {
    pub const SPACE: usize = 32 + 8 + 16 + 1;
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut, seeds = [b"app", app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(
        init_if_needed, payer = user, space = 8 + VotePosition::SPACE,
        seeds = [b"vote_pos", app.key().as_ref(), user.key().as_ref()], bump,
    )]
    pub position: Account<'info, VotePosition>,
    #[account(mut, address = app.vote_vault)]
    pub vote_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.vote_reward_vault)]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
```

Add `ZeroAmount` and `MathOverflow` to `AppmapError`.

**Step 4: Run to verify it passes**

Run: `anchor test`
Expected: PASS

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): VotePosition + vote instruction with accumulator settlement"
```

---

### Task 14: `withdraw_vote` instruction

Mirror of `vote`, moving principal back out and settling pending reward first.

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1: Write the failing test**

```typescript
it("returns principal and zeroes the position on full withdrawal", async () => {
  await program.methods
    .withdrawVote(new anchor.BN(100_000_000))
    .accounts({ app: appPda, position: positionPda, voteVault: voteVaultPda, voteRewardVault: voteRewardVaultPda, userTokenAccount: userAta, user: user.publicKey })
    .signers([user])
    .rpc();

  const position = await program.account.votePosition.fetch(positionPda);
  assert.equal(position.amount.toNumber(), 0);
});
```

**Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `withdrawVote` doesn't exist

**Step 3: Implement**

```rust
    pub fn withdraw_vote(ctx: Context<Vote>, amount: u64) -> Result<()> {
        require!(amount > 0, AppmapError::ZeroAmount);
        let app = &mut ctx.accounts.app;
        let position = &mut ctx.accounts.position;
        require!(position.amount >= amount, AppmapError::InsufficientStake);

        let pending = settle_pending(position.amount, position.reward_debt, app.vote_acc_reward_per_share);
        transfer_from_vault(
            &ctx.accounts.vote_reward_vault, &ctx.accounts.user_token_account, &ctx.accounts.app.to_account_info(),
            &ctx.accounts.token_program, app.key(), app.bump, pending,
        )?;

        position.amount -= amount;
        app.total_vote_stake = app.total_vote_stake.checked_sub(amount).ok_or(AppmapError::MathOverflow)?;
        position.reward_debt = reward_debt_for(position.amount, app.vote_acc_reward_per_share);

        transfer_from_vault(
            &ctx.accounts.vote_vault, &ctx.accounts.user_token_account, &ctx.accounts.app.to_account_info(),
            &ctx.accounts.token_program, app.key(), app.bump, amount,
        )?;
        Ok(())
    }
```

(Reuses the `Vote` accounts struct — same accounts needed.) Add `InsufficientStake` to `AppmapError`.

**Step 4: Run to verify it passes**

Run: `anchor test`
Expected: PASS

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): withdraw_vote instruction"
```

---

### Task 15: `fund_app_rewards` + `claim_vote_reward`

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1: Write the failing test**

```typescript
it("increases the accumulator on funding and pays out proportional claims", async () => {
  // app has one voter with 100_000_000 staked from Task 13
  await program.methods
    .fundAppRewards({ vote: {} }, new anchor.BN(10_000_000))
    .accounts({ app: appPda, config: configPda, voteRewardVault: voteRewardVaultPda, tagsRewardVault: tagsRewardVaultPda, funderTokenAccount: treasuryAta, authority: provider.wallet.publicKey })
    .rpc();

  const before = await getAccount(provider.connection, userAta);
  await program.methods
    .claimVoteReward()
    .accounts({ app: appPda, position: positionPda, voteRewardVault: voteRewardVaultPda, userTokenAccount: userAta, user: user.publicKey })
    .signers([user])
    .rpc();
  const after = await getAccount(provider.connection, userAta);

  assert.equal(Number(after.amount) - Number(before.amount), 10_000_000); // sole staker gets the full funded amount
});
```

**Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — instructions don't exist

**Step 3: Implement**

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RewardPool { Vote, Tags }

    pub fn fund_app_rewards(ctx: Context<FundAppRewards>, pool: RewardPool, amount: u64) -> Result<()> {
        require!(amount > 0, AppmapError::ZeroAmount);
        let app = &mut ctx.accounts.app;
        let (total_stake, target_vault) = match pool {
            RewardPool::Vote => (app.total_vote_stake, &ctx.accounts.vote_reward_vault),
            RewardPool::Tags => (app.total_tag_stake, &ctx.accounts.tags_reward_vault),
        };
        require!(total_stake > 0, AppmapError::NoStakers);

        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder_token_account.to_account_info(),
                    to: target_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        let delta = (amount as u128 * REWARD_PRECISION) / total_stake as u128;
        match pool {
            RewardPool::Vote => app.vote_acc_reward_per_share = app.vote_acc_reward_per_share.checked_add(delta).ok_or(AppmapError::MathOverflow)?,
            RewardPool::Tags => app.tags_acc_reward_per_share = app.tags_acc_reward_per_share.checked_add(delta).ok_or(AppmapError::MathOverflow)?,
        }
        Ok(())
    }

    pub fn claim_vote_reward(ctx: Context<Vote>) -> Result<()> {
        let app = &mut ctx.accounts.app;
        let position = &mut ctx.accounts.position;
        let pending = settle_pending(position.amount, position.reward_debt, app.vote_acc_reward_per_share);
        transfer_from_vault(
            &ctx.accounts.vote_reward_vault, &ctx.accounts.user_token_account, &ctx.accounts.app.to_account_info(),
            &ctx.accounts.token_program, app.key(), app.bump, pending,
        )?;
        position.reward_debt = reward_debt_for(position.amount, app.vote_acc_reward_per_share);
        Ok(())
    }

#[derive(Accounts)]
pub struct FundAppRewards<'info> {
    #[account(mut, seeds = [b"app", app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(mut, address = app.vote_reward_vault)]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.tags_reward_vault)]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub funder_token_account: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
```

Add `NoStakers` to `AppmapError`. `claim_vote_reward` reuses the `Vote` accounts struct (same accounts needed, `amount` argument just unused for this instruction — Anchor allows this).

**Step 4: Run to verify it passes**

Run: `anchor test`
Expected: PASS

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): fund_app_rewards + claim_vote_reward"
```

---

### Task 16: `AppTagAccount` + `suggest_tag` instruction

Mirrors Task 12 (`init_app`), scoped to a tag under an app. Principal vault lives here; reward accumulator stays on the parent `AppAccount` (the tags-pool is shared across all of an app's tags, per the design).

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

**Step 1-4:** Follow the same test-first pattern as Task 12, with:

```rust
    pub fn suggest_tag(ctx: Context<SuggestTag>, app_id: String, tag_id: String) -> Result<()> {
        require!(tag_id.as_bytes().len() <= 32, AppmapError::AppIdTooLong);
        let app_tag = &mut ctx.accounts.app_tag;
        app_tag.app = ctx.accounts.app.key();
        app_tag.tag_id = tag_id;
        app_tag.principal_vault = ctx.accounts.principal_vault.key();
        app_tag.stake_amount = 0;
        app_tag.bump = ctx.bumps.app_tag;
        Ok(())
    }

#[account]
pub struct AppTagAccount {
    pub app: Pubkey,
    pub tag_id: String,
    pub principal_vault: Pubkey,
    pub stake_amount: u64,
    pub bump: u8,
}
impl AppTagAccount {
    pub const SPACE: usize = 32 + 4 + 32 + 32 + 8 + 1;
}
```

with a `SuggestTag` accounts struct following the same `init`/PDA/vault pattern as `InitApp` (seeds `[b"tag", app.key().as_ref(), tag_id.as_bytes()]` for `app_tag`, `[b"tag_vault", app_tag.key().as_ref()]` for `principal_vault`).

**Step 5: Commit**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): AppTagAccount + suggest_tag instruction"
```

---

### Task 17: `StakePosition` + `stake_tag` / `withdraw_tag_stake`

Mirrors Tasks 13-14, with two differences: principal moves in/out of the `AppTagAccount`'s vault (not the app's), and the reward accumulator/debt is computed against `app.tags_acc_reward_per_share` (not a per-tag accumulator), and `app.total_tag_stake` is updated alongside `app_tag.stake_amount`.

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

Follow the same test-first pattern as Tasks 13-14. Key implementation delta from `vote`/`withdraw_vote`:

```rust
    pub fn stake_tag(ctx: Context<StakeTag>, amount: u64) -> Result<()> {
        require!(amount > 0, AppmapError::ZeroAmount);
        let app = &mut ctx.accounts.app;
        let app_tag = &mut ctx.accounts.app_tag;
        let position = &mut ctx.accounts.position;

        if position.amount > 0 {
            let pending = settle_pending(position.amount, position.reward_debt, app.tags_acc_reward_per_share);
            transfer_from_vault(
                &ctx.accounts.tags_reward_vault, &ctx.accounts.user_token_account, &ctx.accounts.app.to_account_info(),
                &ctx.accounts.token_program, app.key(), app.bump, pending,
            )?;
        }

        transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.principal_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            }),
            amount,
        )?;

        position.amount = position.amount.checked_add(amount).ok_or(AppmapError::MathOverflow)?;
        position.owner = ctx.accounts.user.key();
        position.bump = ctx.bumps.position;
        app_tag.stake_amount = app_tag.stake_amount.checked_add(amount).ok_or(AppmapError::MathOverflow)?;
        app.total_tag_stake = app.total_tag_stake.checked_add(amount).ok_or(AppmapError::MathOverflow)?;
        position.reward_debt = reward_debt_for(position.amount, app.tags_acc_reward_per_share);
        Ok(())
    }
```

`withdraw_tag_stake` is the same delta applied to Task 14's pattern (subtract from `app_tag.stake_amount` and `app.total_tag_stake`, return principal from `principal_vault`, settle from `tags_reward_vault`).

`StakePosition` account: identical shape to `VotePosition`. `StakeTag` accounts struct: identical shape to `Vote`'s but keyed by `app_tag` instead of `app` for the position seeds (`[b"stake_pos", app_tag.key().as_ref(), user.key().as_ref()]`), while still including `app` (for the accumulator) and `principal_vault`/`tags_reward_vault`.

**Commit:**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): StakePosition + stake_tag/withdraw_tag_stake instructions"
```

---

### Task 18: `claim_tag_reward`

Mirrors Task 15's `claim_vote_reward`, against `tags_acc_reward_per_share` and the `StakeTag` accounts struct.

**Files:**
- Modify: `programs/appmap/src/lib.rs`
- Modify: `tests/appmap.ts`

Follow the same test-first pattern. Implementation is `claim_vote_reward`'s body with `vote_acc_reward_per_share` → `tags_acc_reward_per_share`, `vote_reward_vault` → `tags_reward_vault`.

**Commit:**

```bash
git add programs/appmap/src/lib.rs tests/appmap.ts
git commit -m "feat(anchor): claim_tag_reward instruction"
```

---

### Task 19: Deploy to devnet

**Files:**
- Modify: `.env` / `.env.example` (`NEXT_PUBLIC_APPMAP_PROGRAM_ID`)

**Step 1: Run the full Anchor test suite one more time locally**

Run: `anchor test`
Expected: PASS, all instructions

**Step 2: Deploy**

Run: `anchor deploy --provider.cluster devnet`
Expected: prints the deployed program id

**Step 3: Record it**

Update `.env.example` and your local `.env`:

```
NEXT_PUBLIC_APPMAP_PROGRAM_ID="<deployed program id>"
```

**Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: record devnet appmap program id"
```

---

### Task 20: Anchor TS client wrapper

**Files:**
- Create: `src/lib/anchorClient.ts`

**Step 1: Write it**

```typescript
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { config } from "@/lib/config";
import idl from "../../target/idl/appmap.json";
import type { Appmap } from "../../target/types/appmap";

export function getAppmapProgram(connection: Connection, wallet: WalletContextState): Program<Appmap> {
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  return new Program(idl as Appmap, new PublicKey(config.solana.programId), provider);
}

export function appPda(programId: PublicKey, appId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("app"), Buffer.from(appId)], programId)[0];
}

export function votePositionPda(programId: PublicKey, app: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()], programId)[0];
}

export function toRawAmount(amount: number): BN {
  return new BN(Math.round(amount * 10 ** config.solana.voteTokenDecimals));
}
```

**Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (requires `target/idl/appmap.json` and `target/types/appmap.ts` to exist from `anchor build` — if this is run in a context without the Anchor toolchain, add a `postinstall`-style note in the README that `anchor build` must run before `npm run build`)

**Step 3: Commit**

```bash
git add src/lib/anchorClient.ts
git commit -m "feat: Anchor program TS client wrapper"
```

---

### Task 21: Replace `useTokenTransfer` with real program calls in `VotePanel` and `TagStakePanel`

**Files:**
- Modify: `src/hooks/useTokenTransfer.ts` → replace with `src/hooks/useVoteProgram.ts` and `src/hooks/useTagStakeProgram.ts`
- Modify: `src/components/app/VotePanel.tsx`
- Modify: `src/components/app/TagStakePanel.tsx`

**Step 1: Write `useVoteProgram`**

```typescript
"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { config, isSimulationMode } from "@/lib/config";
import { getAppmapProgram, appPda, votePositionPda, toRawAmount } from "@/lib/anchorClient";

export function useVoteProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const vote = useCallback(
    async (appId: string, amount: number): Promise<{ txSig: string | null; simulated: boolean }> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getAppmapProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const position = votePositionPda(program.programId, app, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .vote(toRawAmount(amount))
        .accounts({
          app,
          position,
          voteVault: appAccount.voteVault,
          voteRewardVault: appAccount.voteRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  const withdrawVote = useCallback(
    async (appId: string, amount: number): Promise<{ txSig: string | null; simulated: boolean }> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getAppmapProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const position = votePositionPda(program.programId, app, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .withdrawVote(toRawAmount(amount))
        .accounts({
          app,
          position,
          voteVault: appAccount.voteVault,
          voteRewardVault: appAccount.voteRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  return { vote, withdrawVote };
}
```

**Step 2: Update `VotePanel`**

Replace the `useTokenTransfer` import/usage with `useVoteProgram`'s `vote` function; the surrounding component logic (presets, toast, `router.refresh()`) is unchanged — just swap `const transfer = useTokenTransfer(); ... await transfer(amount)` for `const { vote } = useVoteProgram(); ... await vote(appId, amount)`. Add a "Withdraw" button beneath the existing vote button when the user has an active position (fetch it via a new `GET /api/vote?appId=&userId=` or reuse existing app detail data if it already includes the user's position — check `src/lib/queries.ts` for the current app-detail query shape before adding a new endpoint).

**Step 3: Write `useTagStakeProgram`** — same shape as `useVoteProgram`, calling `stakeTag`/`withdrawTagStake` instead, and update `TagStakePanel.tsx` analogously.

**Step 4: Manual verification (no automated test — this touches wallet-signed transactions)**

Run: `npm run dev`, connect a devnet wallet funded with the test vote-token mint, vote on an app, confirm the transaction on Solana Explorer (devnet), confirm the app's vote weight updates in the UI, then withdraw and confirm principal + any pending reward return to the wallet.

**Step 5: Delete the now-unused plain-transfer hook**

Run: `rm src/hooks/useTokenTransfer.ts`

**Step 6: Commit**

```bash
git add src/hooks/useVoteProgram.ts src/hooks/useTagStakeProgram.ts src/components/app/VotePanel.tsx src/components/app/TagStakePanel.tsx
git rm src/hooks/useTokenTransfer.ts
git commit -m "feat: wire vote/stake UI to the real Anchor program"
```

---

## Phase 4: Traffic hardening (CAPTCHA)

### Task 22: Turnstile widget on `TrafficBeacon`

**Files:**
- Modify: `src/components/app/TrafficBeacon.tsx`
- Modify: `.env.example` (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)

**Step 1: Add env vars**

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
TURNSTILE_SECRET_KEY=""
```

**Step 2: Render an invisible Turnstile widget and send its token with the beacon**

```typescript
"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; size: "invisible" }) => void;
    };
  }
}

export function TrafficBeacon({ appId, path }: { appId: string; path: string }) {
  const sent = useRef(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent.current) return;

    function send(turnstileToken: string | null) {
      if (sent.current) return;
      sent.current = true;
      const referrer = typeof document !== "undefined" ? document.referrer : undefined;
      fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, path, referrer, turnstileToken }),
        keepalive: true,
      }).catch(() => {});
    }

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey || !window.turnstile || !widgetRef.current) {
      // No CAPTCHA configured (e.g. local dev) — track without a token; the
      // server marks such views as not revenue-eligible.
      send(null);
      return;
    }
    window.turnstile.render(widgetRef.current, { sitekey: siteKey, size: "invisible", callback: send });
  }, [appId, path]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div ref={widgetRef} />
    </>
  );
}
```

**Step 3: Verify it doesn't break the dev flow (no site key configured locally)**

Run: `npm run dev`, load an app page, confirm `/api/track` still fires and returns `{ ok: true }` (Task 23 makes the server treat a missing/invalid token as non-revenue-eligible rather than rejecting it, so local dev keeps working).

**Step 4: Commit**

```bash
git add src/components/app/TrafficBeacon.tsx .env.example
git commit -m "feat: render Turnstile and send its token with the tracking beacon"
```

---

### Task 23: Server-side Turnstile verification in `/api/track`

**Files:**
- Modify: `src/lib/validation.ts` (`trackViewSchema`)
- Create: `src/lib/turnstile.ts`
- Modify: `src/app/api/track/route.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/turnstile.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns false when no token is provided", async () => {
    expect(await verifyTurnstileToken(null)).toBe(false);
  });

  it("returns true when Cloudflare reports success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    expect(await verifyTurnstileToken("valid-token")).toBe(true);
  });

  it("returns false when Cloudflare reports failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
    expect(await verifyTurnstileToken("bad-token")).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm run test -- turnstile.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement**

```typescript
// src/lib/turnstile.ts
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false; // not configured (local/dev) — never grant revenue eligibility

  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const json = (await res.json()) as { success: boolean };
  return json.success === true;
}
```

**Step 4: Run to verify it passes**

Run: `npm run test -- turnstile.test.ts`
Expected: PASS

**Step 5: Wire it into the track route**

In `src/lib/validation.ts`, add `turnstileToken: z.string().nullable().optional()` to `trackViewSchema`.

In `src/app/api/track/route.ts`:

```typescript
import { verifyTurnstileToken } from "@/lib/turnstile";

export const POST = handler(async (req: NextRequest) => {
  const body = trackViewSchema.parse(await req.json());

  const app = await prisma.app.findUnique({ where: { id: body.appId }, select: { id: true } });
  if (!app) throw new ApiError("App not found", 404);

  const revenueEligible = await verifyTurnstileToken(body.turnstileToken ?? null);

  const pv = await getOrCreatePageView(app.id, req.headers, {
    path: body.path,
    referrer: body.referrer,
    revenueEligible,
  });

  if (!pv) return ok({ tracked: false, reason: "bot" });
  if (!pv.created) return ok({ tracked: false, reason: "duplicate" });

  await refreshApp(app.id);
  return ok({ tracked: true, revenueEligible });
});
```

**Step 6: Run the full suite**

Run: `npm run test && npm run typecheck`
Expected: all green

**Step 7: Commit**

```bash
git add src/lib/turnstile.ts src/lib/turnstile.test.ts src/lib/validation.ts src/app/api/track/route.ts
git commit -m "feat: verify Turnstile server-side, gate revenueEligible on it"
```

---

### Task 24: Filter settlement traffic-share by `revenueEligible`

**Files:**
- Modify: wherever the traffic-share calculation lands (created in Task 26 below) — cross-reference: this task's requirement is that any `prisma.pageView.count`/`groupBy` used for revenue allocation always includes `revenueEligible: true` in its `where`. No standalone code here; fold this filter into Task 26's implementation and Task 8's existing `viewCount` used for *ranking* stays unfiltered (ranking traffic and revenue-eligible traffic are intentionally different counts — all traffic should still boost visibility, only CAPTCHA-verified traffic should earn money). Note this distinction explicitly in a comment where Task 26 computes traffic share.

This task has no standalone code changes — it's a checklist item verified during Task 26's implementation and code review. Skip to Phase 5.

---

## Phase 5: AdSense settlement pipeline

### Task 25: AdSense client wrapper

**Files:**
- Create: `src/lib/adsense.ts`
- Test: `src/lib/adsense.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAdsenseEarnings } from "./adsense";

describe("fetchAdsenseEarnings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the total earnings for the period from the AdSense API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ totals: { cells: [{}, {}, { value: "142.37" }] } }),
      }),
    );
    const earnings = await fetchAdsenseEarnings({ start: new Date("2026-07-01"), end: new Date("2026-07-08") }, "fake-access-token");
    expect(earnings).toBeCloseTo(142.37, 2);
  });

  it("throws when the AdSense API responds with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }));
    await expect(
      fetchAdsenseEarnings({ start: new Date("2026-07-01"), end: new Date("2026-07-08") }, "bad-token"),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm run test -- adsense.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement**

```typescript
// src/lib/adsense.ts
//
// Thin wrapper around the AdSense Management API v2's reports:generate
// endpoint. Requires an OAuth2 access token for a service/user account with
// access to the AdSense property; token acquisition is out of scope here and
// handled by the caller (the settlement script in Task 27).

export interface EarningsPeriod {
  start: Date;
  end: Date;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchAdsenseEarnings(period: EarningsPeriod, accessToken: string): Promise<number> {
  const accountId = process.env.ADSENSE_ACCOUNT_ID;
  if (!accountId) throw new Error("ADSENSE_ACCOUNT_ID is not configured");

  const url = new URL(`https://adsense.googleapis.com/v2/accounts/${accountId}/reports:generate`);
  url.searchParams.set("dateRange", "CUSTOM");
  url.searchParams.set("startDate.year", String(period.start.getUTCFullYear()));
  url.searchParams.set("startDate.month", String(period.start.getUTCMonth() + 1));
  url.searchParams.set("startDate.day", String(period.start.getUTCDate()));
  url.searchParams.set("endDate.year", String(period.end.getUTCFullYear()));
  url.searchParams.set("endDate.month", String(period.end.getUTCMonth() + 1));
  url.searchParams.set("endDate.day", String(period.end.getUTCDate()));
  url.searchParams.set("metrics", "ESTIMATED_EARNINGS");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`AdSense API error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { totals?: { cells?: { value?: string }[] } };
  const raw = json.totals?.cells?.[json.totals.cells.length - 1]?.value ?? "0";
  return parseFloat(raw);
}
```

Note `isoDate` is unused in this draft — either use it to log the period being queried, or drop it; don't leave dead code.

**Step 4: Run to verify it passes**

Run: `npm run test -- adsense.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/adsense.ts src/lib/adsense.test.ts
git commit -m "feat: AdSense Management API client for period earnings"
```

---

### Task 26: Traffic-share allocation

**Files:**
- Create: `src/lib/settlement.ts`
- Test: `src/lib/settlement.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { allocateByTrafficShare } from "./settlement";

describe("allocateByTrafficShare", () => {
  it("splits total earnings proportional to each app's revenue-eligible views", () => {
    const result = allocateByTrafficShare(100, [
      { appId: "a", eligibleViews: 75 },
      { appId: "b", eligibleViews: 25 },
    ]);
    expect(result.find((r) => r.appId === "a")!.gross).toBeCloseTo(75, 6);
    expect(result.find((r) => r.appId === "b")!.gross).toBeCloseTo(25, 6);
  });

  it("returns nothing allocated when there are no eligible views at all", () => {
    const result = allocateByTrafficShare(100, [{ appId: "a", eligibleViews: 0 }]);
    expect(result.find((r) => r.appId === "a")!.gross).toBe(0);
  });

  it("excludes apps with zero eligible views from receiving a share of others' traffic", () => {
    const result = allocateByTrafficShare(100, [
      { appId: "a", eligibleViews: 100 },
      { appId: "b", eligibleViews: 0 },
    ]);
    expect(result.find((r) => r.appId === "b")!.gross).toBe(0);
    expect(result.find((r) => r.appId === "a")!.gross).toBeCloseTo(100, 6);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm run test -- settlement.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement**

```typescript
// src/lib/settlement.ts
//
// Bridges real (aggregate, periodic) AdSense earnings to per-app gross
// revenue by allocating proportional to each app's CAPTCHA-verified,
// revenue-eligible traffic share. This is an allocation model, not exact
// per-impression truth — see docs/plans/2026-07-16-appmap-design.md §4.

export interface AppTraffic {
  appId: string;
  eligibleViews: number;
}

export interface AppAllocation {
  appId: string;
  gross: number;
}

export function allocateByTrafficShare(totalEarnings: number, traffic: AppTraffic[]): AppAllocation[] {
  const totalViews = traffic.reduce((sum, t) => sum + Math.max(0, t.eligibleViews), 0);
  if (totalViews <= 0) {
    return traffic.map((t) => ({ appId: t.appId, gross: 0 }));
  }
  return traffic.map((t) => ({
    appId: t.appId,
    gross: Math.round((totalEarnings * Math.max(0, t.eligibleViews) / totalViews) * 1e9) / 1e9,
  }));
}
```

**Step 4: Run to verify it passes**

Run: `npm run test -- settlement.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/settlement.ts src/lib/settlement.test.ts
git commit -m "feat: traffic-share revenue allocation"
```

---

### Task 27: Settlement script (`npm run settle:epoch`)

Wires Tasks 25-26 plus the two-pool split (Task 5) into a runnable script that also calls `fund_app_rewards` on-chain for each app. Manual/OAuth-token-based for now, per the design doc's phasing — no automated OAuth refresh flow yet.

**Files:**
- Create: `scripts/settleEpoch.ts`
- Modify: `package.json` (add `"settle:epoch": "tsx scripts/settleEpoch.ts"`)

**Step 1: Write the script**

```typescript
// scripts/settleEpoch.ts
//
// Manual settlement run: pulls real AdSense earnings for the trailing period,
// allocates by traffic share, and funds each app's on-chain reward vaults.
// Requires ADSENSE_ACCESS_TOKEN (short-lived OAuth token, obtained out-of-band
// for now) and a funded treasury keypair at TREASURY_KEYPAIR_PATH.

import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { prisma } from "../src/lib/prisma";
import { fetchAdsenseEarnings } from "../src/lib/adsense";
import { allocateByTrafficShare } from "../src/lib/settlement";
import { config } from "../src/lib/config";
import { appPda } from "../src/lib/anchorClient";
import idl from "../target/idl/appmap.json";
import type { Appmap } from "../target/types/appmap";

const SETTLEMENT_LAG_DAYS = 3; // AdSense finalization lag, per the design doc

async function main() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - SETTLEMENT_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);

  const accessToken = process.env.ADSENSE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("ADSENSE_ACCESS_TOKEN is required");
  const totalEarnings = await fetchAdsenseEarnings({ start, end }, accessToken);
  console.log(`AdSense earnings ${start.toISOString()}–${end.toISOString()}: $${totalEarnings}`);

  const apps = await prisma.app.findMany({ select: { id: true, slug: true } });
  const traffic = await Promise.all(
    apps.map(async (app) => ({
      appId: app.id,
      eligibleViews: await prisma.pageView.count({
        where: { appId: app.id, revenueEligible: true, createdAt: { gte: start, lt: end } },
      }),
    })),
  );
  const allocations = allocateByTrafficShare(totalEarnings, traffic);

  const treasuryKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(process.env.TREASURY_KEYPAIR_PATH!, "utf-8"))),
  );
  const connection = new Connection(config.solana.rpc);
  const provider = new AnchorProvider(connection, new Wallet(treasuryKeypair), { commitment: "confirmed" });
  const program = new Program(idl as Appmap, new PublicKey(config.solana.programId), provider);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const mint = new PublicKey(config.solana.voteTokenMint);
  const treasuryAta = await getOrCreateAssociatedTokenAccount(connection, treasuryKeypair, mint, treasuryKeypair.publicKey);

  for (const alloc of allocations) {
    if (alloc.gross <= 0) continue;
    const app = apps.find((a) => a.id === alloc.appId)!;
    console.log(`Settling ${app.slug}: gross $${alloc.gross}`);

    const votePositions = await prisma.vote.findMany({ where: { appId: app.id, active: true }, select: { amount: true } });
    const tagPositions = await prisma.stake.findMany({
      where: { appTag: { appId: app.id }, active: true },
      select: { amount: true },
    });
    const hasVoters = votePositions.length > 0;
    const hasTaggers = tagPositions.length > 0;

    const fee = alloc.gross * 0.1; // must match REVENUE_CONFIG.protocolFee in src/lib/revenue.ts
    const distributable = alloc.gross - fee;
    let voteShare = distributable * 0.5;
    let tagShare = distributable - voteShare;
    if (!hasTaggers) { voteShare = distributable; tagShare = 0; }
    else if (!hasVoters) { tagShare = distributable; voteShare = 0; }

    const app_pda = appPda(program.programId, app.id);
    const appAccount = await program.account.appAccount.fetch(app_pda);

    if (voteShare > 0) {
      await program.methods
        .fundAppRewards({ vote: {} }, new BN(Math.round(voteShare * 10 ** config.solana.voteTokenDecimals)))
        .accounts({
          app: app_pda, config: configPda,
          voteRewardVault: appAccount.voteRewardVault, tagsRewardVault: appAccount.tagsRewardVault,
          funderTokenAccount: treasuryAta.address, authority: treasuryKeypair.publicKey,
        })
        .rpc();
    }
    if (tagShare > 0) {
      await program.methods
        .fundAppRewards({ tags: {} }, new BN(Math.round(tagShare * 10 ** config.solana.voteTokenDecimals)))
        .accounts({
          app: app_pda, config: configPda,
          voteRewardVault: appAccount.voteRewardVault, tagsRewardVault: appAccount.tagsRewardVault,
          funderTokenAccount: treasuryAta.address, authority: treasuryKeypair.publicKey,
        })
        .rpc();
    }
  }

  console.log("Settlement complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Add the npm script**

In `package.json`'s `scripts`:

```json
"settle:epoch": "tsx scripts/settleEpoch.ts"
```

**Step 3: Manual dry-run against a mocked AdSense response**

There's no automated test for this end-to-end script (it needs a funded devnet treasury + deployed program + real/mocked OAuth token — integration-test territory, not unit-test territory). Instead, verify it manually: temporarily stub `fetchAdsenseEarnings` to return a fixed number, point `ADSENSE_ACCOUNT_ID`/`TREASURY_KEYPAIR_PATH` at devnet test fixtures, and run `npm run settle:epoch`, confirming console output shows sensible per-app allocations and the on-chain `fund_app_rewards` calls succeed (check the app's `voteAccRewardPerShare` increased via `anchor account` or a quick script).

**Step 4: Commit**

```bash
git add scripts/settleEpoch.ts package.json
git commit -m "feat: settlement script bridging AdSense earnings to on-chain reward funding"
```

---

## Phase 6: Search & visualization

Note: sort-by-votes/stake/traffic/newest already exists in `src/lib/search.ts` (`sortComparator`) and the facet UI in `Facets.tsx` — no work needed there.

### Task 28: Daily `AppStatsSnapshot` writer

**Files:**
- Create: `src/lib/snapshot.ts`
- Create: `scripts/dailySnapshot.ts`
- Test: `src/lib/snapshot.test.ts`
- Modify: `package.json` (add `"snapshot:daily": "tsx scripts/dailySnapshot.ts"`)

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { writeDailySnapshot } from "./snapshot";

describe("writeDailySnapshot", () => {
  beforeEach(async () => {
    await prisma.appStatsSnapshot.deleteMany();
    await prisma.app.deleteMany();
  });

  it("writes one snapshot row per app for today", async () => {
    const app = await prisma.app.create({
      data: { slug: "snap-app", name: "Snap App", url: "https://example.com", voteWeight: 10, stakeTotal: 5, viewCount: 100, rankScore: 2.5 },
    });

    const count = await writeDailySnapshot();

    expect(count).toBe(1);
    const snapshot = await prisma.appStatsSnapshot.findFirst({ where: { appId: app.id } });
    expect(snapshot!.voteWeight).toBe(10);
  });

  it("is idempotent for the same day (upserts rather than duplicating)", async () => {
    await prisma.app.create({
      data: { slug: "snap-app-2", name: "Snap App 2", url: "https://example.com" },
    });
    await writeDailySnapshot();
    await writeDailySnapshot();
    const count = await prisma.appStatsSnapshot.count();
    expect(count).toBe(1);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm run test -- snapshot.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement**

```typescript
// src/lib/snapshot.ts
import { prisma } from "./prisma";

export async function writeDailySnapshot(): Promise<number> {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  const apps = await prisma.app.findMany({
    select: { id: true, voteWeight: true, stakeTotal: true, viewCount: true, rankScore: true },
  });

  for (const app of apps) {
    await prisma.appStatsSnapshot.upsert({
      where: { appId_date: { appId: app.id, date } },
      create: { appId: app.id, date, voteWeight: app.voteWeight, stakeTotal: app.stakeTotal, viewCount: app.viewCount, rankScore: app.rankScore },
      update: { voteWeight: app.voteWeight, stakeTotal: app.stakeTotal, viewCount: app.viewCount, rankScore: app.rankScore },
    });
  }
  return apps.length;
}
```

**Step 4: Run to verify it passes**

Run: `npm run test -- snapshot.test.ts`
Expected: PASS

**Step 5: Add the script and npm entry**

```typescript
// scripts/dailySnapshot.ts
import { writeDailySnapshot } from "../src/lib/snapshot";

writeDailySnapshot()
  .then((count) => {
    console.log(`Wrote ${count} snapshot rows.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

```json
"snapshot:daily": "tsx scripts/dailySnapshot.ts"
```

**Step 6: Commit**

```bash
git add src/lib/snapshot.ts src/lib/snapshot.test.ts scripts/dailySnapshot.ts package.json
git commit -m "feat: daily AppStatsSnapshot writer"
```

(Deployment note, not a plan task: schedule `npm run snapshot:daily` via whatever cron mechanism the hosting platform provides — e.g. a Vercel Cron Job hitting a protected API route wrapper, or a system cron if self-hosted.)

---

### Task 29: Trend chart on the app detail page

**Files:**
- Create: `src/components/app/TrendChart.tsx`
- Modify: `src/app/api/apps/[slug]/route.ts` (include snapshot history)
- Modify: `src/app/app/[slug]/page.tsx`

**Step 1: Extend the app detail API to return snapshot history**

In `src/app/api/apps/[slug]/route.ts`, alongside the existing app fetch, add:

```typescript
const snapshots = await prisma.appStatsSnapshot.findMany({
  where: { appId: app.id },
  orderBy: { date: "asc" },
  select: { date: true, voteWeight: true, stakeTotal: true, viewCount: true },
});
```

and include `snapshots` in the response payload (check `src/lib/serialize.ts`/`src/lib/types.ts` for where the `AppDTO` shape is defined and extend it there rather than ad-hoc in the route, so the type stays consistent).

**Step 2: Build the chart component**

```typescript
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export function TrendChart({
  data,
}: {
  data: { date: string; voteWeight: number; stakeTotal: number; viewCount: number }[];
}) {
  if (data.length < 2) {
    return <p className="text-sm text-slate-500">Not enough history yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
        <YAxis />
        <Tooltip labelFormatter={(d) => new Date(d as string).toLocaleDateString()} />
        <Line type="monotone" dataKey="voteWeight" stroke="#6366f1" dot={false} name="Votes" />
        <Line type="monotone" dataKey="stakeTotal" stroke="#22c55e" dot={false} name="Tag stake" />
        <Line type="monotone" dataKey="viewCount" stroke="#f59e0b" dot={false} name="Traffic" />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

**Step 3: Render it on the app detail page**

In `src/app/app/[slug]/page.tsx`, add `<TrendChart data={app.snapshots} />` in a new section near the existing sparkline/analytics area.

**Step 4: Manual verification**

Run: `npm run dev`, open a seeded app's detail page (seed data from Task 9 gives 3 apps 14 days of history), confirm the chart renders three lines.

**Step 5: Commit**

```bash
git add src/components/app/TrendChart.tsx src/app/api/apps/[slug]/route.ts src/app/app/[slug]/page.tsx src/lib/serialize.ts src/lib/types.ts
git commit -m "feat: per-app trend chart from AppStatsSnapshot history"
```

---

### Task 30: Tag relationship explorer

**Files:**
- Create: `src/app/tags/page.tsx`
- Create: `src/components/tags/TagExplorer.tsx`
- Create: `src/app/api/tags/graph/route.ts`

**Step 1: Build the graph data endpoint**

```typescript
// src/app/api/tags/graph/route.ts
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET /api/tags/graph — nodes sized by total stake, edges by co-occurrence
// (how often two tags appear together on the same app).
export const GET = handler(async () => {
  const appTags = await prisma.appTag.findMany({
    select: { appId: true, stakeTotal: true, tag: { select: { slug: true, name: true } } },
  });

  const nodeStake = new Map<string, { name: string; stake: number }>();
  const byApp = new Map<string, string[]>();
  for (const at of appTags) {
    const entry = nodeStake.get(at.tag.slug) ?? { name: at.tag.name, stake: 0 };
    entry.stake += at.stakeTotal;
    nodeStake.set(at.tag.slug, entry);
    byApp.set(at.appId, [...(byApp.get(at.appId) ?? []), at.tag.slug]);
  }

  const edgeCounts = new Map<string, number>();
  for (const tags of byApp.values()) {
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join("|");
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return ok({
    nodes: [...nodeStake.entries()].map(([slug, v]) => ({ id: slug, name: v.name, stake: v.stake })),
    edges: [...edgeCounts.entries()].map(([key, weight]) => {
      const [source, target] = key.split("|");
      return { source, target, weight };
    }),
  });
});
```

**Step 2: Build the explorer UI**

Use a simple force-directed layout without a new heavy dependency — implement a lightweight canvas/SVG force simulation, or add `d3-force` (small, focused dependency) if a hand-rolled physics loop is too much surface area. Recommendation: add `d3-force` since reimplementing force-directed layout math is exactly the kind of thing a small, well-tested library should own.

```bash
npm install d3-force
```

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { forceSimulation, forceManyBody, forceLink, forceCenter, type SimulationNodeDatum } from "d3-force";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  stake: number;
}
interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export function TagExplorer({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const [positioned, setPositioned] = useState<GraphNode[]>(nodes);
  const width = 800;
  const height = 500;

  useEffect(() => {
    const sim = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-80))
      .force("link", forceLink(edges as any).id((d: any) => d.id).distance(60))
      .force("center", forceCenter(width / 2, height / 2))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    setPositioned([...nodes]);
  }, [nodes, edges]);

  const maxStake = Math.max(1, ...positioned.map((n) => n.stake));

  return (
    <svg width={width} height={height} className="mx-auto">
      {edges.map((e, i) => {
        const s = positioned.find((n) => n.id === e.source);
        const t = positioned.find((n) => n.id === e.target);
        if (!s || !t) return null;
        return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#334155" strokeWidth={Math.min(4, e.weight)} />;
      })}
      {positioned.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <circle r={6 + 20 * (n.stake / maxStake)} fill="#6366f1" fillOpacity={0.8} />
          <text x={10} y={4} fontSize={11} fill="#e2e8f0">{n.name}</text>
        </g>
      ))}
    </svg>
  );
}
```

**Step 3: Wire the page**

```typescript
// src/app/tags/page.tsx
import { TagExplorer } from "@/components/tags/TagExplorer";
import { config } from "@/lib/config";

export default async function TagsPage() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/tags/graph`, { cache: "no-store" });
  const { data } = await res.json();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Tag explorer</h1>
      <TagExplorer nodes={data.nodes} edges={data.edges} />
    </main>
  );
}
```

Check `src/lib/config.ts`/existing pages for the established pattern of server-side data fetching in this app (several routes already exist under `src/app/**/page.tsx` — match whatever convention `src/app/page.tsx` or `src/app/analytics/page.tsx` already uses instead of introducing a new one, e.g. they may call `searchApps`/query functions directly rather than fetching their own API route over HTTP).

**Step 4: Manual verification**

Run: `npm run dev`, visit `/tags`, confirm nodes render sized by stake and edges connect co-occurring tags from the seed data.

**Step 5: Add a nav link**

Modify `src/components/Navbar.tsx` to add a "Tags" link to `/tags`.

**Step 6: Commit**

```bash
git add src/app/tags/page.tsx src/components/tags/TagExplorer.tsx src/app/api/tags/graph/route.ts src/components/Navbar.tsx package.json package-lock.json
git commit -m "feat: tag relationship explorer"
```

---

## Post-plan checklist

Once all tasks are done, run the full verification sweep before considering this complete:

```bash
npm run typecheck
npm run test
npm run lint
anchor test
npm run build
```

Then re-read the design doc's "Open risks" section (`docs/plans/2026-07-16-appmap-design.md` §7) — the AdSense policy review and the Anchor program security review are both explicitly *not* covered by this plan's automated tests and need separate human/specialist sign-off before any real money moves.
