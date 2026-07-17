"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import type { PoolStatus } from "@/lib/pool";

export interface PoolHistoryPoint {
  t: string; // ISO timestamp
  cumulativeNeb: number;
  cumulativeSol: number;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline p-4">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</div>
      <div className="mt-1 text-heading font-bold text-ink">{value}</div>
    </div>
  );
}

/**
 * Pool-wide dynamic indicators (spot price, % sold, SOL raised, supply left)
 * plus a history chart of cumulative NEB sold, reconstructed from raw
 * NebPurchase rows — there's no precomputed pool snapshot table (unlike
 * AppStatsSnapshot for apps), so this is exact, not sampled.
 */
export function PoolAnalytics({
  pool,
  history,
}: {
  pool: PoolStatus | null;
  history: PoolHistoryPoint[];
}) {
  if (!pool) {
    return (
      <section className="card p-6 text-sm text-slate">
        The {TOKEN_SYMBOL} pool hasn&apos;t been seeded yet.
      </section>
    );
  }

  const pct = Math.round(pool.soldFraction * 100);

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Pool analytics
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Live indicators from the bonding-curve sale — price rises as supply depletes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Spot price" value={`${pool.spotPrice.toFixed(6)} SOL`} />
        <StatTile label="Sold" value={`${pct}%`} />
        <StatTile label="SOL raised" value={pool.solRaised.toFixed(2)} />
        <StatTile label="Remaining" value={formatToken(pool.remainingSupply, TOKEN_SYMBOL)} />
      </div>

      {history.length < 2 ? (
        <p className="text-sm text-slate-steel">Not enough purchase history yet for a chart.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={history}>
            <XAxis
              dataKey="t"
              stroke="#a5a5a5"
              fontSize={11}
              tickFormatter={(t) =>
                new Date(t as string).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
            />
            <YAxis stroke="#a5a5a5" fontSize={11} />
            <Tooltip
              contentStyle={{ background: "#ffffff", border: "1px solid #efefef", borderRadius: 12 }}
              labelFormatter={(t) => new Date(t as string).toLocaleDateString("en-US")}
              formatter={(value: number) => formatToken(value, TOKEN_SYMBOL)}
            />
            <Area
              type="monotone"
              dataKey="cumulativeNeb"
              stroke="#0068f9"
              fill="#0068f9"
              fillOpacity={0.12}
              name={`${TOKEN_SYMBOL} sold`}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
