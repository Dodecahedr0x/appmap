import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildStakeTagTxSchema } from "@/lib/validation";
import { buildStakeTagTx } from "@/lib/indexerClient";

// POST /api/tx/stake-tag — builds an unsigned `stake_tag` transaction.
export const POST = handler(async (req: NextRequest) => {
  const body = buildStakeTagTxSchema.parse(await req.json());
  const built = await buildStakeTagTx(body.appId, body.tagSlug, body.amount, body.user);
  return ok(built);
});
