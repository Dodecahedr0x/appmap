import { handler, ok } from "@/lib/api";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Reads the session cookie, so it must be rendered per-request.
export const dynamic = "force-dynamic";

// GET /api/auth/me — return the current authenticated user (or null).
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ user: null });
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, wallet: true, handle: true },
  });
  return ok({ user });
});
