"use client";

import { useId } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

// DESIGN.md tokens (see tailwind.config.ts): mist=abyss, hairline=gunmetal,
// slate=steel, forest=aurora mint — same values this card used under a
// component-scoped "astro-" prefix before the whole site adopted them.

export interface TrendPoint {
  x: string;
  y: number;
}

// A chart with fewer than 2 points can't draw a line at all. Rather than
// swap in a text fallback (which would make an empty-history card a
// different shape from its neighbors), pad up to this many flat zero
// points — a flat baseline at 0 reads as "nothing here yet" on its own,
// no caption needed, and every card keeps the same layout.
const MIN_POINTS = 7;

function withZeroFloor(data: TrendPoint[]): TrendPoint[] {
  if (data.length >= 2) return data;
  return Array.from({ length: MIN_POINTS }, (_, i) => ({ x: String(i), y: 0 }));
}

/**
 * One Explore-page metric tile: the current value plus a full-bleed filled
 * trend chart underneath (see DESIGN.md's Astro reference).
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
  const gradientId = useId();
  const chartData = withZeroFloor(data);
  // Split "1.23M NEB" -> ["1.23M", "NEB"] so the unit renders smaller and
  // muted next to the bolded figure, matching the reference's "123 Mil"
  // treatment. Values with no unit (plain formatNumber output) just render
  // as the one bolded span.
  const [amount, ...unitParts] = value.split(" ");
  const unit = unitParts.join(" ");

  return (
    <div className="flex flex-col rounded-card border border-hairline bg-mist">
      <div className="min-w-0 p-6 pb-0">
        <div className="text-caption font-semibold uppercase tracking-wide text-slate">
          {label}
        </div>
        {/* flex-wrap, not nowrap: a wide value (e.g. "133.96K NEB") wraps
            the unit to its own line instead of overflowing the card —
            clipping it against the chart wrapper's overflow-hidden below
            was the previous bug here. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-heading-xl font-bold tabular-nums text-forest">
            {amount}
          </span>
          {unit && (
            <span className="text-heading-sm font-semibold text-slate">{unit}</span>
          )}
        </div>
      </div>
      {/* No padding/margin here — the chart bleeds flush to the card's own
          edges (the reference's defining trait). `overflow-hidden` +
          matching `rounded-b-card` are scoped to just this chart strip
          (not the whole card) so a wide value above never gets clipped. */}
      <div className="mt-4 h-16 overflow-hidden rounded-b-card">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4bf3c8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#4bf3c8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="y"
              stroke="#4bf3c8"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
