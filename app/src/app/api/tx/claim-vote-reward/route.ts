import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { buildClaimVoteRewardTxSchema } from "@/lib/validation";
import { buildClaimVoteRewardTx } from "@/lib/indexerClient";

// POST /api/tx/claim-vote-reward — builds an unsigned `claim_vote_reward` transaction.
export const POST = handler(async (req: NextRequest) => {
  const body = buildClaimVoteRewardTxSchema.parse(await req.json());
  const built = await buildClaimVoteRewardTx(body.appId, body.user);
  return ok(built);
});
