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

  const input = searchSchema.parse({
    q: typeof sp.q === "string" ? sp.q : "",
    tags: toArray(sp.tags),
    category: typeof sp.category === "string" ? sp.category : undefined,
    chain: typeof sp.chain === "string" ? sp.chain : undefined,
    sort: typeof sp.sort === "string" ? sp.sort : undefined,
    page: typeof sp.page === "string" ? sp.page : undefined,
  });

  const initial = await searchApps(input);

  return (
    <Suspense fallback={<div className="py-16 text-center text-slate-500">Loading…</div>}>
      <Discover initial={initial} />
    </Suspense>
  );
}
