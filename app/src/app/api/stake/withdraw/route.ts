import { NextRequest } from "next/server";
import { handler, ok, requireUser } from "@/lib/api";
import { unstakeSchema } from "@/lib/validation";
import { withdrawStake } from "@/lib/indexerClient";

// POST /api/stake/withdraw — withdraw all or part of one of your active stakes.
//
// In on-chain mode the treasury would return the tokens via the program; here
// we mark the stake inactive (or reduce its amount, for a partial withdrawal)
// so it stops earning revenue and boosting rank accordingly.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unstakeSchema.parse(await req.json());
  const result = await withdrawStake(body.stakeId, user.id, body.amount);
  return ok(result);
});
