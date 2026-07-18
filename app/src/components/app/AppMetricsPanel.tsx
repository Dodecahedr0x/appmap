"use client";

import { useMemo, useState } from "react";
import { MetricTrendCard, type TrendPoint } from "@/components/explore/MetricTrendCard";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";

export interface AppSnapshotPoint {
  date: string;
  voteWeight: number;
  stakeTotal: number;
  viewCount: number;
  rankScore: number;
}

const INTERVALS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
] as const;

/**
 * Every app-level metric (rank score, votes, stake, views) as its own
 * MetricTrendCard — the same tile Explore uses for platform-wide metrics —
 * all sliced from the same `snapshots` history to a shared, user-picked
 * time window. One AppStatsSnapshot row per day already carries all four
 * fields, so a single interval selection here re-slices every card at once
 * rather than needing a per-metric control or a server round-trip.
 */
export function AppMetricsPanel({
  snapshots,
  current,
}: {
  snapshots: AppSnapshotPoint[];
  /** Latest live values (may be fresher than the last snapshot row). */
  current: { rankScore: number; voteWeight: number; stakeTotal: number; viewCount: number };
}) {
  const [days, setDays] = useState<number | null>(30);

  const windowed = useMemo(() => {
    if (days === null) return snapshots;
    const cutoff = Date.now() - days * 86400_000;
    return snapshots.filter((s) => new Date(s.date).getTime() >= cutoff);
  }, [snapshots, days]);

  const toPoints = (pick: (s: AppSnapshotPoint) => number): TrendPoint[] =>
    windowed.map((s) => ({ x: s.date, y: pick(s) }));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Metrics
        </h2>
        <div className="flex gap-1">
          {INTERVALS.map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => setDays(i.days)}
              className={`chip text-xs ${days === i.days ? "chip-active" : ""}`}
              aria-pressed={days === i.days}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTrendCard
          label="Rank score"
          value={current.rankScore.toFixed(2)}
          data={toPoints((s) => s.rankScore)}
        />
        <MetricTrendCard
          label="Votes"
          value={formatToken(current.voteWeight, TOKEN_SYMBOL)}
          data={toPoints((s) => s.voteWeight)}
        />
        <MetricTrendCard
          label="Total staked"
          value={formatToken(current.stakeTotal, TOKEN_SYMBOL)}
          data={toPoints((s) => s.stakeTotal)}
        />
        <MetricTrendCard
          label="Views"
          value={formatNumber(current.viewCount)}
          data={toPoints((s) => s.viewCount)}
        />
      </div>
    </section>
  );
}
