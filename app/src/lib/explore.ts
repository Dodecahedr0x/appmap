import { prisma } from "./prisma";
import { AppStatus } from "./constants";

export interface PlatformStats {
  totalApps: number;
  totalTags: number;
  totalVoteWeight: number;
  totalStake: number;
  totalViews: number;
}

/** Platform-wide totals for the Explore page's at-a-glance row — cheap aggregate reads over the cached per-app fields, not a recomputation. */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [totalApps, distinctTags, totals] = await Promise.all([
    prisma.app.count({ where: { status: AppStatus.APPROVED } }),
    // prisma.tag.count() would count every tag ever suggested, including
    // ones only attached to a pending/rejected app — scope to tags actually
    // used by an approved app, matching totalApps/the rest of this function.
    prisma.appTag.findMany({
      where: { app: { status: AppStatus.APPROVED } },
      select: { tagId: true },
      distinct: ["tagId"],
    }),
    prisma.app.aggregate({
      where: { status: AppStatus.APPROVED },
      _sum: { voteWeight: true, stakeTotal: true, viewCount: true },
    }),
  ]);

  return {
    totalApps,
    totalTags: distinctTags.length,
    totalVoteWeight: totals._sum.voteWeight ?? 0,
    totalStake: totals._sum.stakeTotal ?? 0,
    totalViews: totals._sum.viewCount ?? 0,
  };
}

export interface ViewsTrendPoint {
  date: string;
  totalViews: number;
}

/**
 * Platform-wide daily page-view trend for the Explore page's chart — page
 * views never touch the chain, so unlike the vote/stake/app/tag metrics
 * (collected by the indexer from on-chain state, see
 * lib/indexerClient.ts's fetchPlatformMetricsHistory), this one's sourced
 * from the existing daily AppStatsSnapshot rows (see lib/snapshot.ts).
 */
export async function getPlatformViewsTrend(): Promise<ViewsTrendPoint[]> {
  const rows = await prisma.appStatsSnapshot.groupBy({
    by: ["date"],
    where: { app: { status: AppStatus.APPROVED } },
    _sum: { viewCount: true },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    date: r.date.toISOString(),
    totalViews: r._sum.viewCount ?? 0,
  }));
}
