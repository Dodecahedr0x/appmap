import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchPlatformMetricsHistory } from "@/lib/indexerClient";
import { requireX402Payment, paymentResponseHeader } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/data/platform-history — x402-priced: the daily on-chain metrics
// time series (app/tag counts, vote stake, tag stake) since the platform's
// first snapshot. See app/src/lib/x402.ts for pricing.
export const GET = handler(async (req: NextRequest) => {
  const gate = await requireX402Payment(req, "platform-history");
  if (!gate.ok) return gate.response;

  const history = await fetchPlatformMetricsHistory();
  return ok(history, { headers: { "PAYMENT-RESPONSE": paymentResponseHeader(gate.receipt) } });
});
