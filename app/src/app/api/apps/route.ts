import { NextRequest } from "next/server";
import { handler, ok, fail, requireUser, ApiError } from "@/lib/api";
import { searchSchema, submitAppSchema } from "@/lib/validation";
import { searchApps } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import { serializeApp, appInclude } from "@/lib/serialize";
import { slugify } from "@/lib/utils";
import { refreshApp } from "@/lib/engine";
import { enrichWithOpenGraph } from "@/lib/opengraph";
import { AppStatus, CATEGORIES, CHAINS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// GET /api/apps — advanced search with facets.
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const input = searchSchema.parse({
    q: sp.get("q") ?? "",
    tags: sp.getAll("tags"),
    fuzzy: sp.get("fuzzy") ?? undefined,
    appStakeMin: sp.get("appStakeMin") ?? undefined,
    appStakeMax: sp.get("appStakeMax") ?? undefined,
    tagsStakeMin: sp.get("tagsStakeMin") ?? undefined,
    tagsStakeMax: sp.get("tagsStakeMax") ?? undefined,
    tagsCountMin: sp.get("tagsCountMin") ?? undefined,
    tagsCountMax: sp.get("tagsCountMax") ?? undefined,
    pageviewsMin: sp.get("pageviewsMin") ?? undefined,
    pageviewsMax: sp.get("pageviewsMax") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  const result = await searchApps(input);
  return ok(result);
});

// POST /api/apps — submit a new app (requires auth).
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = submitAppSchema.parse(await req.json());

  const category = CATEGORIES.includes(body.category as never)
    ? body.category
    : "other";
  const chain = CHAINS.includes(body.chain as never) ? body.chain : "solana";

  // Derive a unique slug.
  const base = slugify(body.name);
  if (!base) throw new ApiError("App name must contain letters or numbers", 400);
  let slug = base;
  for (let i = 2; await prisma.app.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }

  // Reject duplicate URLs to reduce spam/dupes.
  const existingUrl = await prisma.app.findFirst({
    where: { url: body.url },
    select: { slug: true },
  });
  if (existingUrl) {
    return fail(`That URL is already listed as "${existingUrl.slug}"`, 409);
  }

  // Fill in whatever of icon/tagline/description the submitter left blank
  // from the app's own OpenGraph metadata, so apps are presented with real
  // imagery/copy instead of a bare initial even when the submitter skipped
  // the optional fields.
  const enriched = await enrichWithOpenGraph({
    url: body.url,
    iconUrl: body.iconUrl,
    tagline: body.tagline,
    description: body.description,
  });

  const app = await prisma.app.create({
    data: {
      slug,
      name: body.name,
      tagline: enriched.tagline,
      description: enriched.description,
      url: body.url,
      iconUrl: enriched.iconUrl,
      category,
      chain,
      status: AppStatus.APPROVED,
      submittedBy: user.id,
    },
  });

  // Attach suggested tags (creating global tags as needed).
  const uniqueTags = [...new Set(body.tags.map((t) => slugify(t)).filter(Boolean))];
  for (const tagSlug of uniqueTags) {
    const tag = await prisma.tag.upsert({
      where: { slug: tagSlug },
      create: { slug: tagSlug, name: tagSlug.replace(/-/g, " ") },
      update: {},
    });
    await prisma.appTag.upsert({
      where: { appId_tagId: { appId: app.id, tagId: tag.id } },
      create: { appId: app.id, tagId: tag.id, suggestedBy: user.id },
      update: {},
    });
  }

  await refreshApp(app.id);

  const full = await prisma.app.findUnique({
    where: { id: app.id },
    include: appInclude,
  });
  return ok({ app: serializeApp(full!) }, { status: 201 });
});
