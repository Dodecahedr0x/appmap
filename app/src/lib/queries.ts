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
  snapshots: {
    date: string;
    voteWeight: number;
    stakeTotal: number;
    viewCount: number;
    rankScore: number;
  }[];
}

/** Load everything needed to render an app's detail page. */
export async function getAppDetail(slug: string): Promise<AppDetail | null> {
  const app = await prisma.app.findUnique({
    where: { slug },
    include: appInclude,
  });
  if (!app) return null;

  const [recentVotes, topStakers, snapshots] = await Promise.all([
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
    // Full history, not just a fixed recent window — every metric card gets
    // its own configurable interval (7d/30d/90d/all) client-side, sliced
    // from this same array, rather than each needing its own query.
    prisma.appStatsSnapshot.findMany({
      where: { appId: app.id },
      orderBy: { date: "asc" },
      select: { date: true, voteWeight: true, stakeTotal: true, viewCount: true, rankScore: true },
    }),
  ]);

  const stakerUsers = await prisma.user.findMany({
    where: { id: { in: topStakers.map((s) => s.userId) } },
    select: { id: true, wallet: true, handle: true },
  });
  const stakerMap = new Map(stakerUsers.map((u) => [u.id, u]));

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
    snapshots: snapshots.map((s) => ({
      date: s.date.toISOString(),
      voteWeight: s.voteWeight,
      stakeTotal: s.stakeTotal,
      viewCount: s.viewCount,
      rankScore: s.rankScore,
    })),
  };
}
