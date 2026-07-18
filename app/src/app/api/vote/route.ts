import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { voteSchema } from "@/lib/validation";
import { fetchVote, createVote } from "@/lib/indexerClient";
import { isSimulationMode } from "@/lib/config";
import { getSession } from "@/lib/session";

// GET /api/vote?appId= — the current user's active vote for an app, if any.
// Powers the "Withdraw" button in VotePanel. Returns `{ vote: null }` for a
// signed-out visitor rather than 401ing, since this is read-only lookup.
export const GET = handler(async (req: NextRequest) => {
  const appId = req.nextUrl.searchParams.get("appId");
  if (!appId) throw new ApiError("appId is required", 400);

  const session = await getSession();
  if (!session) return ok({ vote: null });

  const vote = await fetchVote(appId, session.userId);
  return ok({ vote });
});

// POST /api/vote — record a token-weighted vote for an app.
//
// In on-chain mode the client first settles an SPL transfer to the treasury and
// passes the confirmed `txSig`; the indexer requires it and enforces
// uniqueness so the same transaction can't be counted twice (see
// indexer/src/handlers/votes.rs). In simulation mode the vote is recorded
// off-chain without a signature.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = voteSchema.parse(await req.json());

  if (!isSimulationMode() && !body.txSig) {
    throw new ApiError("A confirmed transaction signature is required", 400);
  }

  const result = await createVote({
    appId: body.appId,
    userId: user.id,
    amount: body.amount,
    txSig: body.txSig ?? null,
  });

  return ok(result, { status: 201 });
});
