import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { serializeApp, appInclude } from "@/lib/serialize";

export const dynamic = "force-dynamic";

// GET /api/apps/[slug] — full detail for a single app, including recent votes,
// top stakers, and traffic summary.
export const GET = handler(
  async (_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const app = await prisma.app.findUnique({
      where: { slug },
      include: appInclude,
    });
    if (!app) throw new ApiError("App not found", 404);

    const [recentVotes, topStakers, viewsLast7d, snapshots] = await Promise.all([
      prisma.vote.findMany({
        where: { appId: app.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { wallet: true, handle: true } } },
      }),
      prisma.stake.groupBy({
        by: ["userId"],
        where: {
          active: true,
          appTag: { appId: app.id },
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
      prisma.pageView.count({
        where: {
          appId: app.id,
          createdAt: { gte: new Date(Date.now() - 7 * 86400_000) },
        },
      }),
      prisma.appStatsSnapshot.findMany({
        where: { appId: app.id },
        orderBy: { date: "asc" },
        select: { date: true, voteWeight: true, stakeTotal: true, viewCount: true },
      }),
    ]);

    // Resolve staker wallets.
    const stakerUsers = await prisma.user.findMany({
      where: { id: { in: topStakers.map((s) => s.userId) } },
      select: { id: true, wallet: true, handle: true },
    });
    const stakerMap = new Map(stakerUsers.map((u) => [u.id, u]));

    return ok({
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
      viewsLast7d,
      snapshots: snapshots.map((s) => ({
        date: s.date.toISOString(),
        voteWeight: s.voteWeight,
        stakeTotal: s.stakeTotal,
        viewCount: s.viewCount,
      })),
    });
  },
);
