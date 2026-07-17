import { prisma } from "./prisma";

/**
 * Writes one AppStatsSnapshot row per app for today (UTC), upserting so a
 * re-run on the same day updates the existing row rather than duplicating
 * it. Powers the per-app trend chart, which needs daily history rather than
 * just the current cumulative counters.
 */
export async function writeDailySnapshot(): Promise<number> {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  const apps = await prisma.app.findMany({
    select: { id: true, voteWeight: true, stakeTotal: true, viewCount: true, rankScore: true },
  });

  for (const app of apps) {
    await prisma.appStatsSnapshot.upsert({
      where: { appId_date: { appId: app.id, date } },
      create: {
        appId: app.id,
        date,
        voteWeight: app.voteWeight,
        stakeTotal: app.stakeTotal,
        viewCount: app.viewCount,
        rankScore: app.rankScore,
      },
      update: {
        voteWeight: app.voteWeight,
        stakeTotal: app.stakeTotal,
        viewCount: app.viewCount,
        rankScore: app.rankScore,
      },
    });
  }
  return apps.length;
}
