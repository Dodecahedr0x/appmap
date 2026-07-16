"use client";

import type { SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  facets: SearchResult["facets"];
  selectedTags: string[];
  category: string;
  chain: string;
  onToggleTag: (slug: string) => void;
  onSelectCategory: (value: string) => void;
  onSelectChain: (value: string) => void;
  onClear: () => void;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Facets({
  facets,
  selectedTags,
  category,
  chain,
  onToggleTag,
  onSelectCategory,
  onSelectChain,
  onClear,
}: Props) {
  const hasFilters =
    selectedTags.length > 0 || category !== "" || chain !== "";

  return (
    <div className="card space-y-5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Filters</span>
        {hasFilters && (
          <button
            className="text-xs text-brand-purple hover:underline"
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>

      {facets.categories.length > 0 && (
        <Section title="Category">
          <div className="flex flex-col gap-1">
            {facets.categories.map((c) => (
              <button
                key={c.value}
                onClick={() => onSelectCategory(c.value)}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1 text-left text-sm capitalize transition-colors",
                  category === c.value
                    ? "bg-brand-purple/15 text-white"
                    : "text-slate-400 hover:bg-surface-overlay hover:text-white",
                )}
              >
                <span>{c.value}</span>
                <span className="text-xs text-slate-500">{c.count}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {facets.chains.length > 1 && (
        <Section title="Chain">
          <div className="flex flex-wrap gap-1.5">
            {facets.chains.map((c) => (
              <button
                key={c.value}
                onClick={() => onSelectChain(c.value)}
                className={cn(
                  "chip capitalize",
                  chain === c.value && "chip-active",
                )}
              >
                {c.value} <span className="text-slate-500">{c.count}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {facets.tags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {facets.tags.map((t) => (
              <button
                key={t.slug}
                onClick={() => onToggleTag(t.slug)}
                className={cn(
                  "chip",
                  selectedTags.includes(t.slug) && "chip-active",
                )}
              >
                #{t.name} <span className="text-slate-500">{t.count}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
