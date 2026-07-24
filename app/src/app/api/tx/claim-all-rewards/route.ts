import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildClaimAllRewardsTxSchema } from "@/lib/validation";
import { buildClaimAllRewardsTx } from "@/lib/indexerClient";

// POST /api/tx/claim-all-rewards — builds the minimum number of unsigned
// transactions packing every claim in the request, for signAllTransactions.
export const POST = handler(async (req: NextRequest) => {
  const body = buildClaimAllRewardsTxSchema.parse(await req.json());
  const built = await buildClaimAllRewardsTx(body.claims, body.user);
  return ok(built);
});
