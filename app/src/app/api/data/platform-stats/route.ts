import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchPlatformStats } from "@/lib/indexerClient";
import { requireX402Payment, paymentResponseHeader } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/data/platform-stats — x402-priced: platform-wide totals (apps,
// tags, vote weight, tag stake, page views). See app/src/lib/x402.ts for
// pricing and app/about's "Data API" section for the request/response
// example. Distinct from the free, browser-facing /api endpoints (this
// app's own UI never calls this one) — see docs/plans's x402 design note.
export const GET = handler(async (req: NextRequest) => {
  const gate = await requireX402Payment(req, "platform-stats");
  if (!gate.ok) return gate.response;

  const stats = await fetchPlatformStats();
  return ok(stats, { headers: { "PAYMENT-RESPONSE": paymentResponseHeader(gate.receipt) } });
});
