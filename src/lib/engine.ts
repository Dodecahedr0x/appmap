import { prisma } from "./prisma";
import { computeRankScore, ageInDays } from "./ranking";
import { distributeRevenue, type StakePosition } from "./revenue";

// The engine layer bridges the pure ranking/revenue math to the database:
// recomputing cached aggregates, refreshing rank scores, and settling epochs.

/**
 * Recompute the cached aggregate fields for one app from its raw votes,
 * stakes, and page views, then recompute and persist its rank score.
 * Called after any vote / stake / view mutation.
 */
export async function refreshApp(appId: string): Promise<void> {
  const app = await prisma.app.findUnique({ where: { id: appId } });
  if (!app) return;

  const [voteAgg, viewCount, appTags] = await Promise.all([
    prisma.vote.aggregate({
      where: { appId, active: true },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.pageView.count({ where: { appId } }),
    prisma.appTag.findMany({ where: { appId }, select: { id: true } }),
  ]);

  const stakeAgg = await prisma.stake.aggregate({
    where: { appTagId: { in: appTags.map((t) => t.id) }, active: true },
    _sum: { amount: true },
  });

  const voteWeight = voteAgg._sum.amount ?? 0;
  const voteCount = voteAgg._count ?? 0;
  const stakeTotal = stakeAgg._sum.amount ?? 0;

  const rankScore = computeRankScore({
    voteWeight,
    stakeTotal,
    viewCount,
    ageDays: ageInDays(app.createdAt),
  });

  await prisma.app.update({
    where: { id: appId },
    data: { voteWeight, voteCount, stakeTotal, viewCount, rankScore },
  });
}

/** Recompute the cached stakeTotal for a single app-tag. */
export async function refreshAppTag(appTagId: string): Promise<void> {
  const agg = await prisma.stake.aggregate({
    where: { appTagId, active: true },
    _sum: { amount: true },
  });
  await prisma.appTag.update({
    where: { id: appTagId },
    data: { stakeTotal: agg._sum.amount ?? 0 },
  });
}

/**
 * Recompute rank scores for every app. Intended to run periodically (e.g. a
 * cron) so the freshness decay is reflected even for apps with no new activity.
 */
export async function refreshAllRankScores(): Promise<number> {
  const apps = await prisma.app.findMany({
    select: {
      id: true,
      voteWeight: true,
      stakeTotal: true,
      viewCount: true,
      createdAt: true,
    },
  });
  const now = new Date();
  await prisma.$transaction(
    apps.map((app) =>
      prisma.app.update({
        where: { id: app.id },
        data: {
          rankScore: computeRankScore({
            voteWeight: app.voteWeight,
            stakeTotal: app.stakeTotal,
            viewCount: app.viewCount,
            ageDays: ageInDays(app.createdAt, now),
          }),
        },
      }),
    ),
  );
  return apps.length;
}

/**
 * Settle a revenue epoch: sum the ad revenue attributed to the app during the
 * window, distribute it to the app's stakers proportional to their total active
 * stake across the app's tags, and persist RevenueClaim rows.
 */
export async function settleEpoch(epochId: string): Promise<{
  gross: number;
  claims: number;
}> {
  const epoch = await prisma.revenueEpoch.findUnique({
    where: { id: epochId },
    include: { app: true },
  });
  if (!epoch) throw new Error(`Epoch ${epochId} not found`);
  if (epoch.distributed) return { gross: epoch.grossRevenue, claims: 0 };

  // Gross = revenue from impressions in the window not yet assigned to an epoch.
  const impressionAgg = await prisma.adImpression.aggregate({
    where: {
      appId: epoch.appId,
      epochId: null,
      createdAt: { gte: epoch.periodStart, lt: epoch.periodEnd },
    },
    _sum: { revenue: true },
  });
  const gross = impressionAgg._sum.revenue ?? 0;

  // Build stake positions: total active stake per user across this app's tags.
  const appTags = await prisma.appTag.findMany({
    where: { appId: epoch.appId },
    select: { id: true },
  });
  const stakes = await prisma.stake.findMany({
    where: { appTagId: { in: appTags.map((t) => t.id) }, active: true },
    select: { userId: true, amount: true },
  });
  const positions: StakePosition[] = stakes.map((s) => ({
    userId: s.userId,
    stake: s.amount,
  }));

  const result = distributeRevenue(gross, positions);

  await prisma.$transaction(async (tx) => {
    // Tag the impressions as belonging to this epoch.
    await tx.adImpression.updateMany({
      where: {
        appId: epoch.appId,
        epochId: null,
        createdAt: { gte: epoch.periodStart, lt: epoch.periodEnd },
      },
      data: { epochId: epoch.id },
    });

    for (const share of result.shares) {
      await tx.revenueClaim.upsert({
        where: { epochId_userId: { epochId: epoch.id, userId: share.userId } },
        create: { epochId: epoch.id, userId: share.userId, amount: share.amount },
        update: { amount: share.amount },
      });
    }

    await tx.revenueEpoch.update({
      where: { id: epoch.id },
      data: {
        grossRevenue: gross,
        distributed: true,
        closedAt: new Date(),
      },
    });
  });

  return { gross, claims: result.shares.length };
}
