"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TagGraphNode } from "@/lib/tagGraph";
import { AppMap } from "./AppMap";
import { TagMap } from "./TagMap";
import { RelatedApps, type MapSelection } from "./RelatedApps";
import type { MapNode } from "./ForceMap";

type TabKey = "apps" | "tags";

const TABS: { key: TabKey; label: string; description: string }[] = [
  {
    key: "apps",
    label: "Apps",
    description:
      "Apps cluster together when they're tagged alike — a quick way to find something close to an app you already use. Combine tags below to narrow the map down.",
  },
  {
    key: "tags",
    label: "Tags",
    description:
      "Bigger circles have more stake behind them. Tags placed close together tend to show up on the same apps — a way to browse by theme instead of by keyword.",
  },
];

// Cap the tag-filter picker to the most-used tags — same reasoning as the
// Discover page's facet list: showing every tag ever suggested (including
// barely-used ones) would make the picker itself unusable.
const MAX_FILTER_TAGS = 30;

/**
 * Everything the Explore page's constellation maps need, in one panel: a
 * tab bar switching between the app map and the tag map (only the active
 * one is mounted, so only one force simulation ever runs at a time), a
 * tag-combination filter for the app map, and a selected-node "connected
 * apps" panel shared by both tabs. Selecting a node on one map and
 * switching tabs clears the selection, since a tag selection and an app
 * selection aren't the same kind of thing to carry across — but the tag
 * filter itself persists across tabs, since it's a standing preference,
 * not a one-off selection.
 */
export function ExploreMaps() {
  const [tab, setTab] = useState<TabKey>("apps");
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [availableTags, setAvailableTags] = useState<TagGraphNode[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/tags/graph")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const tags: TagGraphNode[] = json.data.nodes ?? [];
        setAvailableTags([...tags].sort((a, b) => b.appCount - a.appCount).slice(0, MAX_FILTER_TAGS));
      })
      .catch(() => {});
  }, []);

  function switchTab(next: TabKey) {
    if (next === tab) return;
    setTab(next);
    setSelection(null);
  }

  function toggleTagFilter(slug: string) {
    setSelection(null);
    setSelectedTags((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
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
    <section className="card space-y-4 p-4 sm:p-6">
      <div
        role="tablist"
        aria-label="Explore maps"
        className="inline-flex gap-1 rounded-navitem border border-hairline bg-ivory p-1"
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
              tab === t.key ? "bg-white text-ink shadow-subtle" : "text-slate hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="max-w-2xl text-sm text-slate">{active.description}</p>

      {tab === "apps" && availableTags.length > 0 && (
        <div>
          <div className="text-caption font-semibold uppercase tracking-wide text-slate">
            Filter by tag{selectedTags.length > 0 ? ` (${selectedTags.length} selected)` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {availableTags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTagFilter(t.id)}
                aria-pressed={selectedTags.includes(t.id)}
                className={cn("chip", selectedTags.includes(t.id) && "chip-active")}
              >
                #{t.name}
              </button>
            ))}
            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="chip text-slate hover:text-ink"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        {tab === "apps" ? (
          <AppMap onSelect={handleAppSelect} selectedTags={selectedTags} />
        ) : (
          <TagMap onSelect={handleTagSelect} />
        )}
      </div>

      {selection && <RelatedApps selection={selection} onClear={() => setSelection(null)} />}
    </section>
  );
}
