import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, ApiError } from "@/lib/api";
import { issueSessionToken, setSessionCookie } from "@/lib/session";
import { isValidWallet } from "@/lib/solana-auth";
import { connectUser } from "@/lib/indexerClient";

const schema = z.object({ wallet: z.string().min(32).max(64) });

// POST /api/auth/connect — a connected wallet is enough to start a session;
// there's no message to sign here. Real authorization for anything that
// spends value still comes from the wallet's signature on the on-chain
// transaction itself, not from this cookie.
export const POST = handler(async (req: NextRequest) => {
  const body = schema.parse(await req.json());
  if (!isValidWallet(body.wallet)) throw new ApiError("Invalid wallet", 400);

  const user = await connectUser(body.wallet);

  const token = issueSessionToken(user.wallet, user.id);
  await setSessionCookie(token);

  return ok({
    user: { id: user.id, wallet: user.wallet, handle: user.handle },
  });
});
