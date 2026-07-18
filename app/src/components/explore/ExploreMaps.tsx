"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TagGraphNode } from "@/lib/tagGraph";
import { AppMap } from "./AppMap";
import { TagMap } from "./TagMap";
import { NebulaField } from "./NebulaField";
import { RelatedApps, type MapSelection } from "./RelatedApps";
import type { MapNode } from "./ForceMap";

// Local dark-glass chip styling for the tag-combination filter — this panel
// sits on the animated nebula backdrop, not the light cream background the
// shared `.chip`/`.chip-active` classes are tuned for (e.g. Discover).
const DARK_CHIP =
  "inline-flex items-center gap-1 rounded-pill border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition-[color,background-color,border-color,transform] duration-150 hover:bg-white/10 active:scale-[0.96]";
const DARK_CHIP_ACTIVE = "border-[#54b9ff]/60 bg-[#54b9ff]/15 text-white";

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
    <div>
      <section className="relative isolate overflow-hidden rounded-card border border-white/10 bg-gradient-to-b from-[#0c0f19] to-[#060913] p-4 sm:p-6">
        {/* WebGL2 nebula/starfield — a purely decorative enhancement. If
            WebGL2 is unavailable or the shader fails, NebulaField renders
            nothing and this gradient (set on the section itself, not
            layered separately) carries the look and the text contrast on
            its own. */}
        <NebulaField className="absolute inset-0 -z-10 h-full w-full" />
        <div className="relative space-y-4">
          <div
            role="tablist"
            aria-label="Explore maps"
            className="inline-flex gap-1 rounded-navitem border border-white/10 bg-white/5 p-1 backdrop-blur-sm"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => switchTab(t.key)}
                className={cn(
                  "rounded-navitem px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.96]",
                  tab === t.key ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="max-w-2xl text-pretty text-sm text-white/60">{active.description}</p>

          {tab === "apps" && availableTags.length > 0 && (
            <div>
              <div className="text-caption font-semibold uppercase tracking-wide text-white/50">
                Filter by tag{selectedTags.length > 0 ? ` (${selectedTags.length} selected)` : ""}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {availableTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTagFilter(t.id)}
                    aria-pressed={selectedTags.includes(t.id)}
                    className={cn(DARK_CHIP, selectedTags.includes(t.id) && DARK_CHIP_ACTIVE)}
                  >
                    #{t.name}
                  </button>
                ))}
                {selectedTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTags([])}
                    className={cn(DARK_CHIP, "text-white/50 hover:text-white/80")}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}

          <div key={tab} className="animate-fade-in-fast">
            {tab === "apps" ? (
              <AppMap onSelect={handleAppSelect} selectedTags={selectedTags} />
            ) : (
              <TagMap onSelect={handleTagSelect} />
            )}
          </div>
        </div>
      </section>

      {selection && <RelatedApps selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
