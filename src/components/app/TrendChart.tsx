"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface TrendPoint {
  date: string;
  voteWeight: number;
  stakeTotal: number;
  viewCount: number;
}

/**
 * Daily history of an app's votes, tag stake, and traffic, from
 * AppStatsSnapshot rows (one per day). Needs at least two points to draw a
 * meaningful line.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) {
    return <p className="text-sm text-slate-500">Not enough history yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <XAxis
          dataKey="date"
          stroke="#64748b"
          fontSize={11}
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
        />
        <YAxis stroke="#64748b" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#121826", border: "1px solid #232b3d" }}
          labelFormatter={(d) => new Date(d as string).toLocaleDateString()}
        />
        <Line type="monotone" dataKey="voteWeight" stroke="#9945FF" dot={false} name="Votes" />
        <Line type="monotone" dataKey="stakeTotal" stroke="#14F195" dot={false} name="Tag stake" />
        <Line type="monotone" dataKey="viewCount" stroke="#19FB9B" dot={false} name="Traffic" />
      </LineChart>
    </ResponsiveContainer>
  );
}
