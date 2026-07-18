import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, ApiError } from "@/lib/api";
import { fetchPlatformTraffic } from "@/lib/indexerClient";
import { requireX402Payment, paymentResponseHeader } from "@/lib/x402";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

// GET /api/data/traffic?start=<ISO8601>&end=<ISO8601> — x402-priced:
// revenue-eligible page-view counts per app in the given date range. Not
// available anywhere else on the site — indexer/src/handlers/revenue.rs's
// traffic() was previously only ever called internally by the revenue
// settlement job. See app/src/lib/x402.ts for pricing.
export const GET = handler(async (req: NextRequest) => {
  const gate = await requireX402Payment(req, "traffic");
  if (!gate.ok) return gate.response;

  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.parse({ start: sp.get("start"), end: sp.get("end") });
  const start = new Date(parsed.start);
  const end = new Date(parsed.end);
  if (end <= start) {
    throw new ApiError("end must be after start", 422);
  }

  const traffic = await fetchPlatformTraffic(start, end);
  return ok(
    { start: start.toISOString(), end: end.toISOString(), viewsByAppId: traffic },
    { headers: { "PAYMENT-RESPONSE": paymentResponseHeader(gate.receipt) } },
  );
});
