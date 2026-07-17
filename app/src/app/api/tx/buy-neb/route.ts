import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildBuyNebTxSchema } from "@/lib/validation";
import { buildBuyNebTx } from "@/lib/indexerClient";

// POST /api/tx/buy-neb — builds an unsigned NEB/USDC Meteora DLMM swap
// transaction (proxied through the indexer's dlmm-bridge sidecar).
export const POST = handler(async (req: NextRequest) => {
  const body = buildBuyNebTxSchema.parse(await req.json());
  const built = await buildBuyNebTx(body.usdcAmount, body.user);
  return ok(built);
});
