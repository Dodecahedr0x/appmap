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
          stroke="#a5a5a5"
          fontSize={11}
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
        />
        <YAxis stroke="#a5a5a5" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #efefef", borderRadius: 12 }}
          labelFormatter={(d) => new Date(d as string).toLocaleDateString()}
        />
        <Line type="monotone" dataKey="voteWeight" stroke="#0068f9" dot={false} name="Votes" />
        <Line type="monotone" dataKey="stakeTotal" stroke="#6736eb" dot={false} name="Tag stake" />
        <Line type="monotone" dataKey="viewCount" stroke="#046645" dot={false} name="Traffic" />
      </LineChart>
    </ResponsiveContainer>
  );
}
