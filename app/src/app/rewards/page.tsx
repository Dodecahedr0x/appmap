import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { serializePoolStatus } from "@/lib/pool";
import { TOKEN_NAME, TOKEN_SYMBOL } from "@/lib/constants";
import { BuyPanel } from "@/components/token/BuyPanel";
import { PoolAnalytics, type PoolHistoryPoint } from "@/components/rewards/PoolAnalytics";
import { ClaimRewards } from "@/components/rewards/ClaimRewards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rewards",
  description: `Buy ${TOKEN_SYMBOL}, track the sale pool, and claim your vote/stake rewards — everything ${TOKEN_SYMBOL}-related on nebulous.world, in one place.`,
};

// Cap purchase history to a reasonable window for the chart — this is a
// cumulative reconstruction from raw NebPurchase rows (no precomputed pool
// snapshot table exists), so we bound it rather than render an unbounded chart.
const HISTORY_LIMIT = 500;

export default async function RewardsPage() {
  const poolRow = await prisma.nebPool.findFirst();
  const pool = poolRow ? serializePoolStatus(poolRow) : null;

  let history: PoolHistoryPoint[] = [];
  if (poolRow) {
    const purchases = await prisma.nebPurchase.findMany({
      where: { poolId: poolRow.id },
      orderBy: { createdAt: "asc" },
      take: HISTORY_LIMIT,
      select: { nebAmount: true, solAmount: true, createdAt: true },
    });
    let cumulativeNeb = 0;
    let cumulativeSol = 0;
    history = purchases.map((p) => {
      cumulativeNeb += p.nebAmount;
      cumulativeSol += p.solAmount;
      return { t: p.createdAt.toISOString(), cumulativeNeb, cumulativeSol };
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-heading-lg font-semibold text-ink">Rewards</h1>
        <p className="mt-2 text-sm text-slate">
          Everything {TOKEN_SYMBOL} lives here: buy {TOKEN_NAME} off the initial sale pool, watch
          the pool&apos;s live indicators, and claim what your votes and tag stakes have earned —
          without withdrawing your principal.
        </p>
      </div>

      <BuyPanel />
      <PoolAnalytics pool={pool} history={history} />
      <ClaimRewards />
    </div>
  );
}
