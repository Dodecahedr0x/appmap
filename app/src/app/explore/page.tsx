import type { Metadata } from "next";
import { getPlatformStats, getPlatformViewsTrend } from "@/lib/explore";
import { fetchPlatformMetricsHistory } from "@/lib/indexerClient";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { config } from "@/lib/config";
import { ExploreMaps } from "@/components/explore/ExploreMaps";
import { MetricTrendCard, type TrendPoint } from "@/components/explore/MetricTrendCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "See what's happening across nebulous.world — top apps, tag trends, and how apps and tags relate to each other.",
};

export default async function ExplorePage() {
  // The on-chain-derived series (apps/tags/votes/stake) comes from the
  // indexer, which is a separate service that can be unreachable in some
  // environments — degrade to an empty trend rather than failing the whole
  // page over a chart that isn't this page's only content (unlike
  // app/rewards/page.tsx, where the indexer status *is* the page).
  const [stats, onchainHistory, viewsTrend] = await Promise.all([
    getPlatformStats(),
    fetchPlatformMetricsHistory().catch(() => []),
    getPlatformViewsTrend(),
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
    <div className="space-y-16">
      <div>
        <h1 className="font-display text-heading-xl font-normal text-ink">Explore</h1>
        <p className="mt-2 max-w-2xl text-pretty text-subheading text-slate">
          A closer look at what&apos;s happening across nebulous.world: who the community is
          backing, which apps are worth a look, and how it all connects.
        </p>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricTrendCard label="Apps" value={formatNumber(stats.totalApps)} data={appsTrend} />
          <MetricTrendCard label="Tags" value={formatNumber(stats.totalTags)} data={tagsTrend} />
          <MetricTrendCard
            label="Votes cast"
            value={formatToken(stats.totalVoteWeight, TOKEN_SYMBOL)}
            data={votesTrend}
          />
          <MetricTrendCard
            label="Staked"
            value={formatToken(stats.totalStake, TOKEN_SYMBOL)}
            data={stakeTrend}
          />
          <MetricTrendCard
            label="Page views"
            value={formatNumber(stats.totalViews)}
            data={viewsTrendPoints}
          />
        </div>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink">Maps</h2>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-slate">
          Two views of how nebulous.world connects — pick a tab, then click a node to see the
          apps behind it.
        </p>
        <div className="mt-6">
          <ExploreMaps />
        </div>
      </section>
    </div>
  );
}
