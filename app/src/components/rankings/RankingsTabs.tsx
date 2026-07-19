"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabKey = "leaderboard" | "map";

const TABS: { key: TabKey; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "map", label: "Map view" },
];

/**
 * Rankings' top-level tab bar: Leaderboard is the default/primary view
 * (comparison-friendly tabular data), Map view is the constellation map —
 * demoted from its old status as the whole Explore page to one optional
 * lens here. See docs/plans/2026-07-19-light-redesign-design.md.
 */
export function RankingsTabs({ leaderboard, map }: { leaderboard: ReactNode; map: ReactNode }) {
  const [tab, setTab] = useState<TabKey>("leaderboard");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Rankings view" className="inline-flex gap-1 rounded-navitem border border-hairline bg-mist p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-navitem px-4 py-2 text-sm font-medium transition-colors duration-150",
              tab === t.key ? "bg-cream text-ink shadow-rest" : "text-slate hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tab === "leaderboard" ? leaderboard : map}</div>
    </div>
  );
}
