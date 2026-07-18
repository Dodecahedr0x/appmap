import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildClosePositionTxSchema } from "@/lib/validation";
import { buildCloseTagStakePositionTx } from "@/lib/indexerClient";

// POST /api/tx/close-tag-stake-position — builds an unsigned `close_tag_stake_position` transaction.
export const POST = handler(async (req: NextRequest) => {
  const body = buildClosePositionTxSchema.parse(await req.json());
  const built = await buildCloseTagStakePositionTx(body.position, body.user);
  return ok(built);
});
