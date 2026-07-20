import { handler, ok } from "@/lib/api";
import { fetchXpLeaderboard } from "@/lib/indexerClient";

// GET /api/xp/leaderboard — top wallets by lifetime XP. Public, cosmetic
// ranking data — no session required, unlike /api/xp/me.
export const GET = handler(async () => {
  const entries = await fetchXpLeaderboard(10);
  return ok(entries);
});
