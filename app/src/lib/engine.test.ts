import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { refreshApp, settleEpoch } from "./engine";

describe("refreshApp", () => {
  let appId: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.vote.deleteMany();
    await prisma.app.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: { wallet: "test-wallet-1" } });
    const app = await prisma.app.create({
      data: { id: "test-app", slug: "test-app", name: "Test App", url: "https://example.com" },
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
    expect(app.voteCount).toBe(1);
  });
});

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
      data: { id: "settle-app", slug: "settle-app", name: "Settle App", url: "https://example.com" },
    });
    await prisma.vote.create({ data: { appId: app.id, userId: voter.id, amount: 10, active: true } });

    const tag = await prisma.tag.create({ data: { id: "defi", slug: "defi", name: "DeFi" } });
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

  it("sums a user's shares when they are active in both the vote pool and the tag pool", async () => {
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

    const voter = await prisma.user.create({ data: { wallet: "voter-only" } });
    const tagger = await prisma.user.create({ data: { wallet: "tagger-only" } });
    const overlap = await prisma.user.create({ data: { wallet: "both-pools" } });
    const app = await prisma.app.create({
      data: { id: "overlap-app", slug: "overlap-app", name: "Overlap App", url: "https://example.com" },
    });

    // Vote pool: voter and overlap each hold half the active vote weight.
    await prisma.vote.create({ data: { appId: app.id, userId: voter.id, amount: 10, active: true } });
    await prisma.vote.create({ data: { appId: app.id, userId: overlap.id, amount: 10, active: true } });

    // Tag pool: tagger and overlap each hold half the active stake.
    const tag = await prisma.tag.create({ data: { id: "defi-2", slug: "defi-2", name: "DeFi 2" } });
    const appTag = await prisma.appTag.create({ data: { appId: app.id, tagId: tag.id } });
    await prisma.stake.create({ data: { appTagId: appTag.id, userId: tagger.id, amount: 10, active: true } });
    await prisma.stake.create({ data: { appTagId: appTag.id, userId: overlap.id, amount: 10, active: true } });

    const ad = await prisma.ad.create({ data: { title: "Ad", targetUrl: "https://example.com", cpm: 2.5 } });
    const pv = await prisma.pageView.create({
      data: { appId: app.id, visitorId: "v2", sessionId: "s2", path: "/", revenueEligible: true },
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

    // fee 10% of 200 = 20, distributable 180, split 90/90.
    // Vote pool (90) split evenly 45/45 between voter and overlap.
    // Tag pool (90) split evenly 45/45 between tagger and overlap.
    expect(result.claims).toBe(4); // 2 vote-pool shares + 2 tag-pool shares

    const voterClaim = await prisma.revenueClaim.findFirst({ where: { userId: voter.id, epochId: epoch.id } });
    const taggerClaim = await prisma.revenueClaim.findFirst({ where: { userId: tagger.id, epochId: epoch.id } });
    const overlapClaims = await prisma.revenueClaim.findMany({ where: { userId: overlap.id, epochId: epoch.id } });

    expect(voterClaim!.amount).toBeCloseTo(45, 6);
    expect(taggerClaim!.amount).toBeCloseTo(45, 6);
    // The overlap user's vote-pool share (45) and tag-pool share (45) must be
    // summed into a single RevenueClaim row via `increment`, not overwritten.
    expect(overlapClaims).toHaveLength(1);
    expect(overlapClaims[0].amount).toBeCloseTo(90, 6);
  });
});
