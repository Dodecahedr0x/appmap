"use client";

import { useEffect, useState } from "react";
import { AppCard } from "@/components/AppCard";
import { AdCard } from "@/components/ads/AdCard";
import { interleaveAds } from "@/lib/adPlacement";
import type { AppDTO } from "@/lib/types";

export interface MapSelection {
  kind: "app" | "tag";
  label: string; // the selected node's display label, for the heading/copy
  slugs?: string[]; // app map: [selectedAppSlug, ...neighborAppSlugs]
  tagSlugs?: string[]; // tag map: [selectedTagSlug, ...neighborTagSlugs]
  selectedSlug?: string; // app map only — badges the exact selected card
}

/**
 * The list of apps a selected map node "means" — the selected node itself
 * plus its connected peers, resolved to real App records via
 * /api/apps/related. Shown below whichever map (app or tag) is active.
 */
export function RelatedApps({
  selection,
  onClear,
}: {
  selection: MapSelection;
  onClear: () => void;
}) {
  const [apps, setApps] = useState<AppDTO[] | null>(null);

  useEffect(() => {
    setApps(null);
    let cancelled = false;
    const qs =
      selection.kind === "app"
        ? `slugs=${encodeURIComponent((selection.slugs ?? []).join(","))}`
        : `tagSlugs=${encodeURIComponent((selection.tagSlugs ?? []).join(","))}`;
    fetch(`/api/apps/related?${qs}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setApps(json.ok ? json.data.apps : []);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  return (
    <div className="mt-8 rounded-card border border-hairline bg-ivory p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate">
            {selection.kind === "app" ? "Connected apps" : "Apps in this tag's neighborhood"}
          </h3>
          <p className="mt-1 text-pretty text-xs text-slate-steel">
            {selection.kind === "app" ? (
              <>
                Apps most similar to <span className="font-medium text-ink">{selection.label}</span>.
              </>
            ) : (
              <>
                Apps tagged <span className="font-medium text-ink">#{selection.label}</span> or a
                closely related tag.
              </>
            )}
          </p>
        </div>
        <button type="button" onClick={onClear} className="btn-ghost shrink-0 text-xs">
          Clear
        </button>
      </div>

      <div className="mt-4">
        {apps === null ? (
          <p className="text-sm text-slate">Loading…</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-slate">No approved apps match this selection yet.</p>
        ) : (
          <div className="animate-fade-in grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {interleaveAds(apps).map((entry) =>
              entry.kind === "ad" ? (
                <AdCard key={entry.key} appId={entry.appId} />
              ) : (
                <div key={entry.app.id} className="relative">
                  {entry.app.slug === selection.selectedSlug && (
                    <span className="absolute -left-2 -top-2 z-10 rounded-full bg-violet px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-subtle">
                      Selected
                    </span>
                  )}
                  <AppCard app={entry.app} />
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
