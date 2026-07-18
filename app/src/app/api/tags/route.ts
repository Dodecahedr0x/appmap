import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchTags } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/tags — list tags with usage + total-stake, for facets & discovery.
export const GET = handler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";
  const result = await fetchTags(q || undefined);
  return ok(result);
});
