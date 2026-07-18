import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { z } from "zod";
import { serveAd } from "@/lib/indexerClient";
import { resolveVisitor } from "@/lib/tracking";

const schema = z.object({
  appId: z.string().min(1),
  path: z.string().max(300).optional(),
});

// POST /api/ads/serve — serve one ad for an app page and record the impression.
//
// The impression is attached to the visitor's page view and credited with
// revenue (cpm / 1000). That revenue accrues to the app and is later
// distributed to its stakers when the current epoch settles. Visitor
// identity is resolved here (needs the tracking secret + raw headers, see
// tracking.ts) and passed to the indexer already-derived.
export const POST = handler(async (req: NextRequest) => {
  const body = schema.parse(await req.json());
  const visitor = resolveVisitor(req.headers);
  if (visitor.isBot) return ok({ ad: null, reason: "bot" });

  const result = await serveAd(body.appId, {
    visitorId: visitor.visitorId,
    sessionId: visitor.sessionId,
    userAgent: visitor.userAgent,
    path: body.path,
    referrer: req.headers.get("referer"),
  });
  return ok(result);
});
