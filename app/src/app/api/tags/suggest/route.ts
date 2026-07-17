import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/api";
import { suggestTagSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { serializeTag } from "@/lib/serialize";

// POST /api/tags/suggest — anyone (authenticated) can suggest a tag for an app.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = suggestTagSchema.parse(await req.json());

  const app = await prisma.app.findUnique({ where: { id: body.appId } });
  if (!app) throw new ApiError("App not found", 404);

  const slug = slugify(body.tag);
  if (!slug) throw new ApiError("Tag must contain letters or numbers", 400);

  const tag = await prisma.tag.upsert({
    where: { slug },
    create: { slug, name: body.tag.trim().toLowerCase() },
    update: {},
  });

  const existing = await prisma.appTag.findUnique({
    where: { appId_tagId: { appId: app.id, tagId: tag.id } },
  });
  if (existing) throw new ApiError("This app already has that tag", 409);

  const appTag = await prisma.appTag.create({
    data: { appId: app.id, tagId: tag.id, suggestedBy: user.id },
    include: { tag: true },
  });

  return ok({ tag: serializeTag(appTag) }, { status: 201 });
});
