import { NextRequest } from "next/server";
import { handler, ok, requireUser } from "@/lib/api";
import { unvoteAllSchema } from "@/lib/validation";
import { withdrawAllVotes } from "@/lib/indexerClient";

// POST /api/vote/withdraw-all — withdraw every active vote on one app at
// once (a user can vote on the same app more than once over time, each
// adding to the single on-chain VotePosition — see indexer/src/handlers/
// votes.rs's withdraw_all). Used by the rewards page's "Your rewards"
// unstake action, which withdraws the same aggregated amount on-chain.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unvoteAllSchema.parse(await req.json());
  const result = await withdrawAllVotes(body.appId, user.id);
  return ok(result);
});
