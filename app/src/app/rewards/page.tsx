import type { Metadata } from "next";
import {
  fetchPoolStatus,
  fetchPlatformStats,
  fetchPlatformMetricsHistory,
  fetchPlatformViewsTrend,
} from "@/lib/indexerClient";
import { TOKEN_NAME, TOKEN_SYMBOL, SITE_URL } from "@/lib/constants";
import { config } from "@/lib/config";
import { BuyPanel } from "@/components/token/BuyPanel";
import { PoolAnalytics } from "@/components/rewards/PoolAnalytics";
import { PlatformMetrics } from "@/components/rewards/PlatformMetrics";
import { ClaimRewards } from "@/components/rewards/ClaimRewards";
import { CloseZeroStakeAccounts } from "@/components/rewards/CloseZeroStakeAccounts";
import type { TrendPoint } from "@/components/explore/MetricTrendCard";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rewards",
  description: `Buy ${TOKEN_SYMBOL}, track the pool, and claim your vote/stake rewards — everything ${TOKEN_SYMBOL}-related on nebulous.world, in one place.`,
  alternates: { canonical: `${SITE_URL}/rewards` },
};

export default async function RewardsPage() {
  // The on-chain-derived series (apps/tags/votes/stake) comes from the
  // indexer, which is a separate service that can be unreachable in some
  // environments — degrade to an empty trend rather than failing the whole
  // page over a chart that isn't the page's only content.
  const [pool, stats, onchainHistory, viewsTrend] = await Promise.all([
    fetchPoolStatus(),
    fetchPlatformStats(),
    fetchPlatformMetricsHistory().catch(() => []),
    fetchPlatformViewsTrend(),
  ]);

  const scale = 10 ** config.solana.voteTokenDecimals;
  const appsTrend: TrendPoint[] = onchainHistory.map((p) => ({ x: p.capturedAt, y: p.appCount }));
  const tagsTrend: TrendPoint[] = onchainHistory.map((p) => ({ x: p.capturedAt, y: p.tagCount }));
  const votesTrend: TrendPoint[] = onchainHistory.map((p) => ({
    x: p.capturedAt,
    y: Number(p.totalVoteStake) / scale,
  }));
  const stakeTrend: TrendPoint[] = onchainHistory.map((p) => ({
    x: p.capturedAt,
    y: Number(p.totalTagStake) / scale,
  }));
  const viewsTrendPoints: TrendPoint[] = viewsTrend.map((p) => ({ x: p.date, y: p.totalViews }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Rewards"
        description={
          <>
            Everything {TOKEN_SYMBOL} lives here: buy {TOKEN_NAME} on the public NEB/USDC pool,
            watch its live indicators, and claim what your votes and tag stakes have earned —
            without withdrawing your principal.
          </>
        }
      />

      <BuyPanel />
      <PoolAnalytics pool={pool} />
      <PlatformMetrics
        stats={stats}
        appsTrend={appsTrend}
        tagsTrend={tagsTrend}
        votesTrend={votesTrend}
        stakeTrend={stakeTrend}
        viewsTrend={viewsTrendPoints}
      />
      <ClaimRewards />
      <CloseZeroStakeAccounts />
    </div>
  );
}
