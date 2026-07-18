import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { z } from "zod";
import { clickAd } from "@/lib/indexerClient";

const schema = z.object({ impressionId: z.string().min(1) });

// POST /api/ads/click — flag an impression as clicked (for CTR analytics).
export const POST = handler(async (req: NextRequest) => {
  const body = schema.parse(await req.json());
  await clickAd(body.impressionId);
  return ok({ ok: true });
});
