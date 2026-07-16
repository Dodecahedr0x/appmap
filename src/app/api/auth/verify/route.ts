import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { authVerifySchema } from "@/lib/validation";
import { verifyNonce, issueSessionToken, setSessionCookie } from "@/lib/session";
import { verifySignature, isValidWallet } from "@/lib/solana-auth";
import { prisma } from "@/lib/prisma";

// POST /api/auth/verify — verify the signed challenge and start a session.
export const POST = handler(async (req: NextRequest) => {
  const body = authVerifySchema.parse(await req.json());

  if (!isValidWallet(body.wallet)) throw new ApiError("Invalid wallet", 400);

  // The nonce must be present in the signed message and independently valid.
  if (!body.message.includes(body.nonce)) {
    throw new ApiError("Nonce/message mismatch", 400);
  }
  if (!verifyNonce(body.nonce)) {
    throw new ApiError("Challenge expired — please try again", 400);
  }
  if (!verifySignature(body.wallet, body.message, body.signature)) {
    throw new ApiError("Signature verification failed", 401);
  }

  // Upsert the user by wallet.
  const user = await prisma.user.upsert({
    where: { wallet: body.wallet },
    create: { wallet: body.wallet },
    update: {},
  });

  const token = issueSessionToken(user.wallet, user.id);
  await setSessionCookie(token);

  return ok({
    user: { id: user.id, wallet: user.wallet, handle: user.handle },
  });
});
