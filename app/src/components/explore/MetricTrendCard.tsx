"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface TrendPoint {
  x: string;
  y: number;
}

/**
 * One Explore-page metric tile: the current value plus a compact line
 * chart of how it evolved over time. Replaces the old bare-number
 * StatTile — same card shell, same label/value styling, with a trend line
 * underneath instead of nothing. Mirrors app/TrendChart.tsx's recharts
 * setup, just shorter (one series, no legend) to fit five side by side.
 */
export function MetricTrendCard({
  label,
  value,
  data,
}: {
  label: string;
  value: string;
  data: TrendPoint[];
}) {
  return (
    <div className="card p-6">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">
        {label}
      </div>
      <div className="mt-1 text-heading-xl font-bold tabular-nums text-ink">{value}</div>
      <div className="mt-3 h-16">
        {data.length < 2 ? (
          <div className="flex h-full items-center text-xs text-slate-steel">
            Not enough history yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="x" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #efefef",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(x) => new Date(x as string).toLocaleString()}
                formatter={(y: number) => [y.toLocaleString(), label]}
              />
              <Line type="monotone" dataKey="y" stroke="#0068f9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
