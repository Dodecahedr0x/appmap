import { Suspense } from "react";
import type { Metadata } from "next";
import { Discover } from "@/components/discover/Discover";
import { searchApps } from "@/lib/indexerClient";
import { searchSchema } from "@/lib/validation";
import { SITE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Every search/filter/sort/page combination lives at this same route via
// query params (?q=, ?tags=, ?sort=, ?page=, ...) — without a canonical tag
// each of those would be indexable as its own near-duplicate page, diluting
// the site's ranking signal across thousands of filter combinations instead
// of concentrating it on the one canonical listing. `noindex` (but `follow`,
// so crawlers still reach every /app/[slug] linked from a filtered result)
// applies only when a real filter/sort/page is active — the bare homepage
// stays indexed normally.
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const isFiltered = Object.entries(sp).some(([key, value]) => {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      return false;
    }
    if (key === "sort" && value === "rank") return false;
    if (key === "page" && value === "1") return false;
    return true;
  });

  return {
    alternates: { canonical: SITE_URL },
    ...(isFiltered ? { robots: { index: false, follow: true } } : {}),
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
    page: str(sp.page),
  });

  const initial = await searchApps(input);

  return (
    <Suspense fallback={<div className="py-16 text-center text-slate-steel">Loading…</div>}>
      <Discover initial={initial} />
    </Suspense>
  );
}
