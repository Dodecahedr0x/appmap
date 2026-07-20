import { NextRequest } from "next/server";
import { handler, ok, requireUser } from "@/lib/api";
import { unstakeAllSchema } from "@/lib/validation";
import { withdrawAllStakes } from "@/lib/indexerClient";

// POST /api/stake/withdraw-all — withdraw every active stake on one app-tag
// at once (a user can stake on the same tag more than once over time, each
// adding to the single on-chain StakePosition — see indexer/src/handlers/
// stakes.rs's withdraw_all). Used by the rewards page's "Your rewards"
// unstake action, which withdraws the same aggregated amount on-chain.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unstakeAllSchema.parse(await req.json());
  const result = await withdrawAllStakes(body.appTagId, user.id);
  return ok(result);
});
