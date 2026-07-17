import { handler, ok } from "@/lib/api";
import { buildTagGraph } from "@/lib/tagGraph";

export const dynamic = "force-dynamic";

// GET /api/tags/graph — nodes sized by total stake, edges by co-occurrence
// (how often two tags appear together on the same app).
export const GET = handler(async () => {
  const graph = await buildTagGraph();
  return ok(graph);
});
