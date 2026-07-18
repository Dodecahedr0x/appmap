import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchAppGraph } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/apps/graph[?tags=slug1,slug2] — apps clustered by shared tags,
// for the Explore page's app map. `tags`, if given, restricts the map to
// apps carrying every one of those tags (see indexer/src/handlers/platform.rs's
// `build_app_graph` doc comment).
export const GET = handler(async (req: NextRequest) => {
  const tags = req.nextUrl.searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const graph = await fetchAppGraph(tags);
  return ok(graph);
});
