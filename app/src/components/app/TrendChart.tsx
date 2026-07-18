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
    return <p className="text-sm text-slate-steel">Not enough history yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <XAxis
          dataKey="date"
          stroke="#858b98"
          fontSize={11}
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
        />
        <YAxis stroke="#858b98" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#17191e", border: "1px solid #545864", borderRadius: 12, color: "#f2f6fa" }}
          labelFormatter={(d) => new Date(d as string).toLocaleDateString()}
        />
        <Line type="monotone" dataKey="voteWeight" stroke="#54b9ff" dot={false} name="Votes" />
        <Line type="monotone" dataKey="stakeTotal" stroke="#acafff" dot={false} name="Tag stake" />
        <Line type="monotone" dataKey="viewCount" stroke="#4bf3c8" dot={false} name="Traffic" />
      </LineChart>
    </ResponsiveContainer>
  );
}
