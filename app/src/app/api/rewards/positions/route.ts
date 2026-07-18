import { handler, ok } from "@/lib/api";
import { fetchRewardsPositions } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

// GET /api/rewards/positions — every app/tag the current user has an active
// vote or tag stake on, across the whole platform (unlike GET /api/vote and
// GET /api/stake, which are scoped to one appId). Powers the Rewards tab's
// claim list: for each position returned here, the client derives the
// on-chain PDA and reads the pending reward directly from the chain (DB has
// no visibility into on-chain accumulator state — see lib/rewards.ts).
// Returns empty arrays for a signed-out visitor rather than 401ing, same
// convention as GET /api/vote/GET /api/stake. The collapse-to-one-position-
// per-(app)/(app,tag) logic lives in indexer/src/handlers/rewards.rs now —
// see that file's doc comment for why it's needed.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ votes: [], stakes: [] });

  const result = await fetchRewardsPositions(session.userId);
  return ok(result);
});
