import { Suspense } from "react";
import { Discover } from "@/components/discover/Discover";
import { searchApps } from "@/lib/search";
import { searchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
