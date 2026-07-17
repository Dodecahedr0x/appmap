import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildAppGraph } from "@/lib/appGraph";

export const dynamic = "force-dynamic";

// GET /api/apps/graph[?tags=slug1,slug2] — apps clustered by shared tags,
// for the Explore page's app map. `tags`, if given, restricts the map to
// apps carrying every one of those tags (see buildAppGraph's doc comment).
export const GET = handler(async (req: NextRequest) => {
  const tags = req.nextUrl.searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const graph = await buildAppGraph(tags);
  return ok(graph);
});
