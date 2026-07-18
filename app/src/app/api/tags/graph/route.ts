import { handler, ok } from "@/lib/api";
import { fetchTagGraph } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/tags/graph — nodes sized by total stake or app count, edges by
// co-occurrence or similarity (how often/how uniquely two tags share an app).
export const GET = handler(async () => {
  const graph = await fetchTagGraph();
  return ok(graph);
});
