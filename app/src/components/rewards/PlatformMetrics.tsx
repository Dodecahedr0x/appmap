import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { MetricTrendCard, type TrendPoint } from "@/components/explore/MetricTrendCard";
import type { PlatformStats } from "@/lib/indexerClient";

/**
 * Platform-wide activity — apps, tags, votes cast, and stake, alongside
 * page-view traffic — each with a trend sparkline. Used to live on the
 * Explore page, but it's a snapshot of the whole product, not something
 * that helps you find or compare a specific app/tag the way the maps do —
 * moved here to sit with the rest of the product's "read the numbers"
 * surfaces (see PoolAnalytics above), leaving Explore to just the maps.
 */
export function PlatformMetrics({
  stats,
  appsTrend,
  tagsTrend,
  votesTrend,
  stakeTrend,
  viewsTrend,
}: {
  stats: PlatformStats;
  appsTrend: TrendPoint[];
  tagsTrend: TrendPoint[];
  votesTrend: TrendPoint[];
  stakeTrend: TrendPoint[];
  viewsTrend: TrendPoint[];
}) {
  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Platform activity
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Apps, tags, votes, and stake across nebulous.world, plus page-view traffic.
        </p>
      </div>

      {/* 3 columns, not the wider 5-across grid this used on the (full-width)
          Explore page — the rewards page's own container is a narrower
          max-w-2xl reading column (see rewards/page.tsx), so 5 columns
          there would squeeze each tile down to an illegible sliver. 3 wraps
          the 5 cards to two rows instead, staying legible at this width. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricTrendCard label="Apps" value={formatNumber(stats.totalApps)} data={appsTrend} />
        <MetricTrendCard label="Tags" value={formatNumber(stats.totalTags)} data={tagsTrend} />
        <MetricTrendCard
          label="Votes cast"
          value={formatToken(stats.totalVoteWeight, TOKEN_SYMBOL)}
          data={votesTrend}
          valueKind="token"
        />
        <MetricTrendCard
          label="Staked"
          value={formatToken(stats.totalStake, TOKEN_SYMBOL)}
          data={stakeTrend}
          valueKind="token"
        />
        <MetricTrendCard label="Page views" value={formatNumber(stats.totalViews)} data={viewsTrend} />
      </div>
    </section>
  );
}
