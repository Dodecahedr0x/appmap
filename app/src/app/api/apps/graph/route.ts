import { handler, ok } from "@/lib/api";
import { buildAppGraph } from "@/lib/appGraph";

export const dynamic = "force-dynamic";

// GET /api/apps/graph — apps clustered by shared tags, for the Explore page's app map.
export const GET = handler(async () => {
  const graph = await buildAppGraph();
  return ok(graph);
});
