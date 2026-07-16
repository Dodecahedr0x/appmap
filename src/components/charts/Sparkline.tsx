"use client";

interface Point {
  label: string;
  value: number;
}

/**
 * A lightweight, dependency-free SVG sparkline/bar chart for small inline
 * trends (e.g. 7-day traffic). Renders bars with a hover tooltip via <title>.
 */
export function Sparkline({
  data,
  height = 80,
}: {
  data: Point[];
  height?: number;
}) {
  if (data.length === 0) {
    return <div className="text-sm text-slate-500">No data yet.</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 4;

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * (height - 20));
        return (
          <div
            key={i}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
            style={{ gap }}
          >
            <div className="relative w-full">
              <div
                className="w-full rounded-t bg-brand-gradient transition-all group-hover:opacity-80"
                style={{ height: h }}
                title={`${d.label}: ${d.value}`}
              />
            </div>
            <span className="text-[10px] text-slate-500">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
