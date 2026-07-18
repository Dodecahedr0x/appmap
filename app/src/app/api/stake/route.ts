import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { stakeSchema } from "@/lib/validation";
import { fetchStakes, createStake } from "@/lib/indexerClient";
import { isSimulationMode } from "@/lib/config";
import { getSession } from "@/lib/session";

// GET /api/stake?appId= — the current user's active stakes across all of an
// app's tags, if any. Powers the per-tag "Withdraw" button in TagStakePanel.
// Returns `{ stakes: [] }` for a signed-out visitor rather than 401ing.
export const GET = handler(async (req: NextRequest) => {
  const appId = req.nextUrl.searchParams.get("appId");
  if (!appId) throw new ApiError("appId is required", 400);

  const session = await getSession();
  if (!session) return ok({ stakes: [] });

  const stakes = await fetchStakes(appId, session.userId);
  return ok({ stakes });
});

// POST /api/stake — stake tokens behind an app's tag.
//
// Stake boosts the tag's weight and entitles the staker to a share of the
// app's ad revenue. On-chain mode requires a confirmed transfer signature.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = stakeSchema.parse(await req.json());

  const result = await createStake({
    appTagId: body.appTagId,
    userId: user.id,
    amount: body.amount,
    txSig: body.txSig ?? null,
    simulationMode: isSimulationMode(),
  });

  return ok(result, { status: 201 });
});
