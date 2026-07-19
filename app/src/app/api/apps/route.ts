import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { searchSchema } from "@/lib/validation";
import { searchApps } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/apps — advanced search with facets.
//
// There is no POST here any more: app creation is an on-chain-first flow
// now (see components/discover/CreateAppForm.tsx, hooks/useCreateAppProgram.ts,
// POST /api/tx/create-app) — the client builds+signs+submits an `init_app`
// (+ `suggest_tag`) transaction directly, and the `App` row is created by
// the indexer once it observes the confirmed transaction (see
// indexer/src/processors/product.rs), not by a Prisma write from this app.
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const input = searchSchema.parse({
    q: sp.get("q") ?? "",
    tags: sp.getAll("tags"),
    fuzzy: sp.get("fuzzy") ?? undefined,
    appStakeMin: sp.get("appStakeMin") ?? undefined,
    appStakeMax: sp.get("appStakeMax") ?? undefined,
    tagsStakeMin: sp.get("tagsStakeMin") ?? undefined,
    tagsStakeMax: sp.get("tagsStakeMax") ?? undefined,
    tagsCountMin: sp.get("tagsCountMin") ?? undefined,
    tagsCountMax: sp.get("tagsCountMax") ?? undefined,
    pageviewsMin: sp.get("pageviewsMin") ?? undefined,
    pageviewsMax: sp.get("pageviewsMax") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  const result = await searchApps(input);
  return ok(result);
});
