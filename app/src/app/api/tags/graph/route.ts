import { handler, ok } from "@/lib/api";
import { buildTagGraph } from "@/lib/tagGraph";

export const dynamic = "force-dynamic";

// GET /api/tags/graph — nodes sized by total stake or app count, edges by
// co-occurrence or similarity (how often/how uniquely two tags share an app).
export const GET = handler(async () => {
  const graph = await buildTagGraph();
  return ok(graph);
});
