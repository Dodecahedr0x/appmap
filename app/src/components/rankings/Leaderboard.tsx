"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AppDTO } from "@/lib/types";
import { formatToken, formatNumber, hostname, cn, formatDelta } from "@/lib/utils";

type SortKey = "rank" | "voteWeight" | "stakeTotal" | "viewCount";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "rank", label: "Rank" },
  { key: "voteWeight", label: "Votes" },
  { key: "stakeTotal", label: "Staked" },
  { key: "viewCount", label: "Views" },
];

function DeltaCell({ deltaPct, intervalDays }: { deltaPct?: number | null; intervalDays?: number }) {
  const delta = intervalDays != null ? formatDelta(deltaPct ?? null, intervalDays) : null;
  if (!delta) return <span className="text-slate-steel">—</span>;
  return (
    <span className={cn("tabular-nums", (deltaPct ?? 0) >= 0 ? "text-forest" : "text-negative")}>
      {delta}
    </span>
  );
}

/**
 * A dense, sortable leaderboard — the same underlying app data as the
 * Browse grid, in a comparison-friendly tabular form. Lives on the
 * Rankings page's default tab (see docs/plans/2026-07-19-light-redesign-design.md).
 *
 * `apps` is expected to be a small, pre-bounded list — e.g. top 50 — since
 * sorting happens client-side over the full array on every column click.
 */
export function Leaderboard({ apps }: { apps: AppDTO[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...apps];
    copy.sort((a, b) => {
      const av = sortKey === "rank" ? a.rankScore : a[sortKey];
      const bv = sortKey === "rank" ? b.rankScore : b[sortKey];
      return sortDesc ? bv - av : av - bv;
    });
    return copy;
  }, [apps, sortKey, sortDesc]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-caption uppercase tracking-wide text-slate-steel">
            <th className="px-4 py-3 font-semibold">App</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-4 py-3 font-semibold"
                aria-sort={sortKey === c.key ? (sortDesc ? "descending" : "ascending") : "none"}
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={cn(
                    "flex items-center gap-1 transition-colors duration-150 hover:text-ink",
                    sortKey === c.key && "text-cobalt",
                  )}
                >
                  {c.label}
                  {sortKey === c.key && (sortDesc ? "↓" : "↑")}
                </button>
              </th>
            ))}
            <th className="px-4 py-3 font-semibold">7d trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((app, i) => (
            <tr key={app.id} className="border-b border-hairline last:border-0 hover:bg-mist">
              <td className="px-4 py-3">
                <Link href={`/app/${app.slug}`} className="flex items-center gap-2 hover:text-cobalt">
                  <span className="w-5 shrink-0 tabular-nums text-slate-steel">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{app.name}</span>
                    <span className="block truncate text-xs text-slate-steel">{hostname(app.url)}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3 tabular-nums text-ink">{app.rankScore.toFixed(2)}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatToken(app.voteWeight, "")}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatToken(app.stakeTotal, "")}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatNumber(app.viewCount)}</td>
              <td className="px-4 py-3">
                <DeltaCell deltaPct={app.trend?.rankScorePct} intervalDays={app.trend?.intervalDays} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
