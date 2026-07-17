"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppMap } from "./AppMap";
import { TagMap } from "./TagMap";
import { RelatedApps, type MapSelection } from "./RelatedApps";
import type { MapNode } from "./ForceMap";

type TabKey = "apps" | "tags";

const TABS: { key: TabKey; label: string; description: string }[] = [
  {
    key: "apps",
    label: "Similar apps",
    description:
      "Apps cluster together when they're tagged alike — a quick way to find something close to an app you already use.",
  },
  {
    key: "tags",
    label: "Tags that travel together",
    description:
      "Bigger circles have more stake behind them. Tags placed close together tend to show up on the same apps — a way to browse by theme instead of by keyword.",
  },
];

/**
 * Everything the Explore page's constellation maps need: a tab bar
 * switching between the app map and the tag map (only the active one is
 * mounted, so only one force simulation ever runs at a time), and a
 * selected-node "connected apps" panel shared by both tabs. Selecting a
 * node on one map and switching tabs clears the selection, since a tag
 * selection and an app selection aren't the same kind of thing to carry
 * across.
 */
export function ExploreMaps() {
  const [tab, setTab] = useState<TabKey>("apps");
  const [selection, setSelection] = useState<MapSelection | null>(null);

  function switchTab(next: TabKey) {
    if (next === tab) return;
    setTab(next);
    setSelection(null);
  }

  function handleAppSelect(node: MapNode | null, neighborIds: string[]) {
    if (!node) {
      setSelection(null);
      return;
    }
    setSelection({ kind: "app", label: node.label, slugs: [node.id, ...neighborIds], selectedSlug: node.id });
  }

  function handleTagSelect(node: MapNode | null, neighborIds: string[]) {
    if (!node) {
      setSelection(null);
      return;
    }
    setSelection({ kind: "tag", label: node.label, tagSlugs: [node.id, ...neighborIds] });
  }

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Explore maps"
        className="inline-flex gap-1 rounded-navitem border border-hairline bg-white p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={cn(
              "rounded-navitem px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-ivory text-ink" : "text-slate hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-3 max-w-2xl text-sm text-slate">{active.description}</p>

      <div className="mt-6">
        {tab === "apps" ? <AppMap onSelect={handleAppSelect} /> : <TagMap onSelect={handleTagSelect} />}
      </div>

      {selection && <RelatedApps selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
