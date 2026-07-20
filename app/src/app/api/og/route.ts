import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { fetchOpenGraph } from "@/lib/opengraph";

export const dynamic = "force-dynamic";

// GET /api/og?url=<page> — on-demand OpenGraph fetch for the create-app
// form's live card preview (see components/discover/CreateAppForm.tsx).
// Every other caller of lib/opengraph.ts's fetchOpenGraph runs offline
// (scripts/backfillOpengraph.ts, after an app already exists) — this is the
// only live path, hit once per debounced URL change while filling the form.
export const GET = handler(async (req: NextRequest) => {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) throw new ApiError("url is required", 400);
  try {
    new URL(url);
  } catch {
    throw new ApiError("Invalid URL", 400);
  }

  const og = await fetchOpenGraph(url);
  return ok({ og });
});
