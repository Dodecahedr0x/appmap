import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { voteSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshApp } from "@/lib/engine";
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

  const vote = await prisma.vote.findFirst({
    where: { appId, userId: session.userId, active: true },
    select: { id: true, amount: true },
  });
  return ok({ vote });
});

// POST /api/vote — record a token-weighted vote for an app.
//
// In on-chain mode the client first settles an SPL transfer to the treasury and
// passes the confirmed `txSig`; we require it and enforce uniqueness so the same
// transaction can't be counted twice. In simulation mode the vote is recorded
// off-chain without a signature.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = voteSchema.parse(await req.json());

  const app = await prisma.app.findUnique({ where: { id: body.appId } });
  if (!app) throw new ApiError("App not found", 404);

  if (!isSimulationMode() && !body.txSig) {
    throw new ApiError("A confirmed transaction signature is required", 400);
  }

  if (body.txSig) {
    const existing = await prisma.vote.findUnique({
      where: { txSig: body.txSig },
    });
    if (existing) throw new ApiError("This transaction was already recorded", 409);
  }

  const vote = await prisma.vote.create({
    data: {
      appId: body.appId,
      userId: user.id,
      amount: body.amount,
      txSig: body.txSig ?? null,
    },
  });

  await refreshApp(body.appId);
  const updated = await prisma.app.findUnique({
    where: { id: body.appId },
    select: { voteWeight: true, voteCount: true, rankScore: true },
  });

  return ok(
    {
      vote: { id: vote.id, amount: vote.amount, txSig: vote.txSig },
      app: updated,
    },
    { status: 201 },
  );
});
