import { Suspense } from "react";
import type { Metadata } from "next";
import { Discover } from "@/components/discover/Discover";
import { searchApps } from "@/lib/indexerClient";
import { searchSchema } from "@/lib/validation";
import { SITE_URL } from "@/lib/constants";
import { JsonLd } from "@/components/JsonLd";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Every search/filter/sort/page combination lives at this same route via
// query params (?q=, ?tags=, ?sort=, ?page=, ...) — shared by generateMetadata
// (canonical/robots below) and the page body (whether to emit ItemList
// JSON-LD for the listing) so the two can't drift out of sync on what
// counts as "the bare canonical homepage" vs. a filtered variant.
function isFilteredSearch(sp: Record<string, string | string[] | undefined>): boolean {
  return Object.entries(sp).some(([key, value]) => {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      return false;
    }
    if (key === "sort" && value === "rank") return false;
    if (key === "page" && value === "1") return false;
    return true;
  });
}

// Without a canonical tag each filter combination would be indexable as its
// own near-duplicate page, diluting the site's ranking signal across
// thousands of combinations instead of concentrating it on the one
// canonical listing. `noindex` (but `follow`, so crawlers still reach every
// /app/[slug] linked from a filtered result) applies only when a real
// filter/sort/page is active — the bare homepage stays indexed normally.
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  return {
    alternates: { canonical: SITE_URL },
    ...(isFilteredSearch(sp) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const toArray = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v : v ? [v] : [];

  const str = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : undefined;

  const input = searchSchema.parse({
    q: str(sp.q) ?? "",
    tags: toArray(sp.tags),
    fuzzy: str(sp.fuzzy),
    appStakeMin: str(sp.appStakeMin),
    appStakeMax: str(sp.appStakeMax),
    tagsStakeMin: str(sp.tagsStakeMin),
    tagsStakeMax: str(sp.tagsStakeMax),
    tagsCountMin: str(sp.tagsCountMin),
    tagsCountMax: str(sp.tagsCountMax),
    pageviewsMin: str(sp.pageviewsMin),
    pageviewsMax: str(sp.pageviewsMax),
    sort: str(sp.sort),
    // No `page`: results grow via infinite scroll now (see Discover.tsx),
    // so the server-rendered page is always the first one regardless of
    // any stale `?page=` on a link shared before that change.
  });

  const initial = await searchApps(input);

  // Only on the canonical, unfiltered listing — an ItemList for a filtered
  // variant would just be more indexable-duplicate-content surface area,
  // the opposite of what the noindex above is trying to avoid.
  const listLd = !isFilteredSearch(sp)
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: initial.apps.map((app, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE_URL}/app/${app.slug}`,
          name: app.name,
        })),
      }
    : null;

  return (
    <Suspense fallback={<div className="py-16 text-center text-slate-steel">Loading…</div>}>
      {listLd && <JsonLd data={listLd} />}
      <Discover initial={initial} />
    </Suspense>
  );
}
