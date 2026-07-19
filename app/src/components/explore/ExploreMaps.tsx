"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TagGraph } from "@/lib/indexerClient";
type TagGraphNode = TagGraph["nodes"][number];
import { AppMap } from "./AppMap";
import { TagMap } from "./TagMap";
import { GroupMap } from "./GroupMap";
import { RelatedApps, type MapSelection } from "./RelatedApps";
import { TagAutocomplete } from "./TagAutocomplete";
import type { MapNode } from "./ForceMap";

type TabKey = "apps" | "tags" | "group";

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
  {
    key: "group",
    label: "Group",
    description:
      "Apps nested by tag, from the most common tag down to the most specific. Outer circles are broad themes, inner circles narrow them down, and the smallest filled circles are individual apps. Click an app to zoom in, or a tag (here or below) to filter down to it — drag to pan, scroll to zoom.",
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
  // Drives the Tags tab's "typing a tag selects it on the map" behavior —
  // see ForceMap's `selectRequest` doc comment for why this needs to be a
  // fresh object every time rather than just the tag's id.
  const [tagSelectRequest, setTagSelectRequest] = useState<{ id: string } | null>(null);

  useEffect(() => {
    fetch("/api/tags/graph")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const tags: TagGraphNode[] = json.data.nodes ?? [];
        const mostUsed = [...tags].sort((a, b) => b.appCount - a.appCount).slice(0, MAX_FILTER_TAGS);
        setAvailableTags(mostUsed.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);

  function switchTab(next: TabKey) {
    if (next === tab) return;
    setTab(next);
    setSelection(null);
    // A stale request would otherwise re-fire on remount (each tab's map
    // fully remounts via the `key={tab}` below) and silently re-select
    // whatever was last picked — selection doesn't persist across tabs
    // anywhere else in this component either (see `setSelection(null)`
    // above), so this shouldn't be the one exception.
    setTagSelectRequest(null);
  }

  function toggleTagFilter(slug: string) {
    setSelection(null);
    setSelectedTags((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }

  // Tags tab only: picking a tag from the search box selects it on the map
  // exactly as clicking its node would (see TagMap/ForceMap's
  // `selectRequest` prop) — there's no "filter" concept on this tab (every
  // tag is always shown), so typing a tag jumps to it instead of narrowing
  // anything down.
  function selectTagOnMap(slug: string) {
    setTagSelectRequest({ id: slug });
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

  // Unlike AppMap/TagMap (which hand back a raw MapNode + neighbor ids for
  // this component to interpret), GroupMap already knows its own tree
  // structure well enough to build the MapSelection itself.
  function handleGroupSelect(next: MapSelection | null) {
    setSelection(next);
  }

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      {/* Same light Surface/bg-ivory card treatment as every other panel in
          the app (see .card in globals.css) — this used to be a bespoke
          dark-glass treatment (translucent white overlays, a hand-picked
          abyss → singularity gradient) built for when this was the one dark
          section on an otherwise light-cream page, sitting on an animated
          nebula backdrop. Now that the whole app has been repainted to the
          shared light theme (see DESIGN.md) and the nebula backdrop is gone,
          that bespoke treatment would read as visually out of step with
          everything else — this panel is a card like any other now. */}
      <section className="card overflow-hidden p-4 sm:p-6">
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="Explore maps"
            className="inline-flex gap-1 rounded-navitem border border-hairline bg-mist p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => switchTab(t.key)}
                className={cn(
                  "rounded-navitem px-4 py-2 text-sm font-medium transition-[color,background-color] duration-150",
                  tab === t.key ? "bg-ivory text-ink" : "text-slate hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="max-w-2xl text-pretty text-sm text-slate">{active.description}</p>

          {(tab === "apps" || tab === "group") && availableTags.length > 0 && (
            <div>
              <div className="text-caption font-semibold uppercase tracking-wide text-slate">
                Filter by tag{selectedTags.length > 0 ? ` (${selectedTags.length} selected)` : ""}
              </div>
              <div className="mt-1.5 max-w-xs">
                <TagAutocomplete
                  options={availableTags}
                  excludeIds={selectedTags}
                  onSelect={toggleTagFilter}
                  placeholder="Search tags to filter by…"
                  ariaLabel="Search tags to filter the map by"
                />
              </div>
              {/* Selected tags live below the search box, not in it — the
                  box always starts empty (see TagAutocomplete's own doc
                  comment: it's a picker, not a persistent search field), so
                  this is the only place the current filter is visible.
                  Clicking one removes it, same toggle the search box's
                  onSelect uses to add it. */}
              {selectedTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedTags.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => toggleTagFilter(slug)}
                      className="chip chip-active"
                    >
                      #{availableTags.find((t) => t.id === slug)?.name ?? slug}
                      <span aria-hidden="true">✕</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setSelectedTags([])} className="chip">
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "tags" && availableTags.length > 0 && (
            <div>
              <div className="text-caption font-semibold uppercase tracking-wide text-slate">
                Jump to a tag
              </div>
              <div className="mt-1.5 max-w-xs">
                <TagAutocomplete
                  options={availableTags}
                  onSelect={selectTagOnMap}
                  placeholder="Search tags…"
                  ariaLabel="Search for a tag to select it on the map"
                />
              </div>
            </div>
          )}

          <div key={tab} className="animate-fade-in-fast">
            {tab === "apps" ? (
              <AppMap onSelect={handleAppSelect} selectedTags={selectedTags} />
            ) : tab === "tags" ? (
              <TagMap onSelect={handleTagSelect} selectRequest={tagSelectRequest} />
            ) : (
              <GroupMap onSelect={handleGroupSelect} selectedTags={selectedTags} onToggleTag={toggleTagFilter} />
            )}
          </div>
        </div>
      </section>

      {selection && <RelatedApps selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
