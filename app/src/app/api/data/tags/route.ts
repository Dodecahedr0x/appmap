import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchTagGraph } from "@/lib/indexerClient";
import { requireX402Payment, paymentResponseHeader } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/data/tags — x402-priced: every tag in use (stake + app count),
// plus which tags most often appear together on the same app — the same
// co-occurrence data the Explore page's tag map computes, repackaged as a
// stable queryable resource instead of a UI graph payload. See
// app/src/lib/x402.ts for pricing.
export const GET = handler(async (req: NextRequest) => {
  const gate = await requireX402Payment(req, "tags");
  if (!gate.ok) return gate.response;

  const graph = await fetchTagGraph();
  const data = {
    tags: graph.nodes.map((n) => ({ slug: n.id, name: n.name, stake: n.stake, appCount: n.appCount })),
    coOccurrence: graph.edges.map((e) => ({ a: e.source, b: e.target, appsSharing: e.weight, similarity: e.similarity })),
  };
  return ok(data, { headers: { "PAYMENT-RESPONSE": paymentResponseHeader(gate.receipt) } });
});
