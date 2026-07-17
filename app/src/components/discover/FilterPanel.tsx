"use client";

import { useMemo, useState } from "react";
import type { SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface RangeFilters {
  appStakeMin: string;
  appStakeMax: string;
  tagsStakeMin: string;
  tagsStakeMax: string;
  tagsCountMin: string;
  tagsCountMax: string;
  pageviewsMin: string;
  pageviewsMax: string;
}

export const EMPTY_RANGE_FILTERS: RangeFilters = {
  appStakeMin: "",
  appStakeMax: "",
  tagsStakeMin: "",
  tagsStakeMax: "",
  tagsCountMin: "",
  tagsCountMax: "",
  pageviewsMin: "",
  pageviewsMax: "",
};

interface Props {
  facets: SearchResult["facets"];
  selectedTags: string[];
  onToggleTag: (slug: string) => void;
  ranges: RangeFilters;
  onRangeChange: (key: keyof RangeFilters, value: string) => void;
  fuzzy: string;
  onFuzzyChange: (value: string) => void;
  onClear: () => void;
}

function RangeRow({
  label,
  minKey,
  maxKey,
  ranges,
  onRangeChange,
}: {
  label: string;
  minKey: keyof RangeFilters;
  maxKey: keyof RangeFilters;
  ranges: RangeFilters;
  onRangeChange: (key: keyof RangeFilters, value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="input px-2 py-1.5 text-sm"
          placeholder="Min"
          value={ranges[minKey]}
          onChange={(e) => onRangeChange(minKey, e.target.value)}
          aria-label={`${label} minimum`}
        />
        <span className="text-slate-steel">–</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="input px-2 py-1.5 text-sm"
          placeholder="Max"
          value={ranges[maxKey]}
          onChange={(e) => onRangeChange(maxKey, e.target.value)}
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  );
}

/** Number of active filters, for the collapsed toggle's badge count. */
export function countActiveFilters(
  selectedTags: string[],
  ranges: RangeFilters,
  fuzzy: string,
): number {
  const rangeCount = Object.values(ranges).filter((v) => v !== "").length;
  return selectedTags.length + rangeCount + (fuzzy.trim() ? 1 : 0);
}

/**
 * The Discover filters: a floating, collapsible panel anchored to the right
 * edge of the viewport (starts collapsed). Filters split cleanly along the
 * product's own data model — tags (onchain, stake-weighted) and OpenGraph
 * text (offchain) — there is no separate "category" taxonomy here.
 */
export function FilterPanel({
  facets,
  selectedTags,
  onToggleTag,
  ranges,
  onRangeChange,
  fuzzy,
  onFuzzyChange,
  onClear,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");

  const activeCount = countActiveFilters(selectedTags, ranges, fuzzy);
  const hasFilters = activeCount > 0;

  // Live-filter the tag list by the search box, but never hide a tag that's
  // currently selected — losing sight of an active filter while typing would
  // be confusing.
  const visibleTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return facets.tags;
    return facets.tags.filter(
      (t) => t.name.toLowerCase().includes(q) || selectedTags.includes(t.slug),
    );
  }, [facets.tags, tagSearch, selectedTags]);

  return (
    <div className="fixed right-4 top-24 z-40 flex flex-col items-end">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "btn-secondary gap-2 rounded-pill shadow-subtle",
          isOpen && "rounded-b-none border-b-0",
        )}
        aria-expanded={isOpen}
        aria-controls="discover-filter-panel"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4h18M6 12h12M10 20h4"
          />
        </svg>
        Filters
        {hasFilters && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cobalt px-1 text-[11px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="discover-filter-panel"
          className="card mt-0 max-h-[75vh] w-72 space-y-5 overflow-y-auto rounded-tr-none p-4 shadow-subtle"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Filters</span>
            {hasFilters && (
              <button
                className="text-xs text-cobalt hover:underline"
                onClick={onClear}
              >
                Clear
              </button>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.077em] text-slate-steel">
              Tags
            </h3>
            <input
              className="input mb-2 px-2 py-1.5 text-sm"
              placeholder="Search tags…"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              aria-label="Search tags"
            />
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {visibleTags.length === 0 ? (
                <span className="text-xs text-slate-steel">No matching tags.</span>
              ) : (
                visibleTags.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => onToggleTag(t.slug)}
                    className={cn(
                      "chip",
                      selectedTags.includes(t.slug) && "chip-active",
                    )}
                  >
                    #{t.name} <span className="text-slate-steel">{t.count}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.077em] text-slate-steel">
              Description search
            </h3>
            <input
              className="input px-2 py-1.5 text-sm"
              placeholder="Fuzzy match name, tagline, description…"
              value={fuzzy}
              onChange={(e) => onFuzzyChange(e.target.value)}
              aria-label="Fuzzy search app text"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-caption font-semibold uppercase tracking-[0.077em] text-slate-steel">
              Ranges
            </h3>
            <RangeRow
              label="App stake"
              minKey="appStakeMin"
              maxKey="appStakeMax"
              ranges={ranges}
              onRangeChange={onRangeChange}
            />
            <RangeRow
              label="Tags stake"
              minKey="tagsStakeMin"
              maxKey="tagsStakeMax"
              ranges={ranges}
              onRangeChange={onRangeChange}
            />
            <RangeRow
              label="Number of tags"
              minKey="tagsCountMin"
              maxKey="tagsCountMax"
              ranges={ranges}
              onRangeChange={onRangeChange}
            />
            <RangeRow
              label="Pageviews"
              minKey="pageviewsMin"
              maxKey="pageviewsMax"
              ranges={ranges}
              onRangeChange={onRangeChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
