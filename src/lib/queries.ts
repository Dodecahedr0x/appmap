import { prisma } from "./prisma";
import { serializeApp, appInclude } from "./serialize";
import type { AppDTO } from "./types";

// Server-side data loaders shared between server components and API routes.

export interface AppDetail {
  app: AppDTO;
  recentVotes: {
    id: string;
    amount: number;
    createdAt: string;
    wallet: string;
    txSig: string | null;
  }[];
  topStakers: { wallet: string; amount: number }[];
  viewsLast7d: number;
  dailyViews: { date: string; views: number }[];
  snapshots: {
    date: string;
    voteWeight: number;
    stakeTotal: number;
    viewCount: number;
  }[];
}

/** Load everything needed to render an app's detail page. */
export async function getAppDetail(slug: string): Promise<AppDetail | null> {
  const app = await prisma.app.findUnique({
    where: { slug },
    include: appInclude,
  });
  if (!app) return null;

  const since = new Date(Date.now() - 7 * 86400_000);
  const [recentVotes, topStakers, views, snapshots] = await Promise.all([
    prisma.vote.findMany({
      where: { appId: app.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { wallet: true, handle: true } } },
    }),
    prisma.stake.groupBy({
      by: ["userId"],
      where: { active: true, appTag: { appId: app.id } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 8,
    }),
    prisma.pageView.findMany({
      where: { appId: app.id, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.appStatsSnapshot.findMany({
      where: { appId: app.id },
      orderBy: { date: "asc" },
      select: { date: true, voteWeight: true, stakeTotal: true, viewCount: true },
    }),
  ]);

  const stakerUsers = await prisma.user.findMany({
    where: { id: { in: topStakers.map((s) => s.userId) } },
    select: { id: true, wallet: true, handle: true },
  });
  const stakerMap = new Map(stakerUsers.map((u) => [u.id, u]));

  // Bucket views by day for the last 7 days.
  const dailyMap = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const v of views) {
    const key = v.createdAt.toISOString().slice(0, 10);
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
  }

  return {
    app: serializeApp(app),
    recentVotes: recentVotes.map((v) => ({
      id: v.id,
      amount: v.amount,
      createdAt: v.createdAt.toISOString(),
      wallet: v.user.handle ?? v.user.wallet,
      txSig: v.txSig,
    })),
    topStakers: topStakers.map((s) => ({
      wallet:
        stakerMap.get(s.userId)?.handle ??
        stakerMap.get(s.userId)?.wallet ??
        s.userId,
      amount: s._sum.amount ?? 0,
    })),
    viewsLast7d: views.length,
    dailyViews: [...dailyMap.entries()].map(([date, v]) => ({
      date,
      views: v,
    })),
    snapshots: snapshots.map((s) => ({
      date: s.date.toISOString(),
      voteWeight: s.voteWeight,
      stakeTotal: s.stakeTotal,
      viewCount: s.viewCount,
    })),
  };
}
