import { PrismaClient } from "@prisma/client";
import { slugify } from "../../src/lib/utils";
import { DATASOURCES } from "./datasources";
import { tagApp } from "./tagger";
import type { RawApp } from "./types";

// Seeds the database from real, live data sources (see datasources/) instead
// of the hand-written fixtures in prisma/seed.ts. Tags are generated per app
// by shelling out to `claude -p` (see tagger.ts). Upserts by slug/tag, so it's
// safe to re-run and safe to run alongside prisma/seed.ts.
//
// Usage:
//   tsx scripts/seed-live/index.ts [--limit=40] [--source=defillama] [--concurrency=4] [--dry-run] [--model=haiku]

const prisma = new PrismaClient();

interface Args {
  limit: number;
  source?: string;
  concurrency: number;
  dryRun: boolean;
  model: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 40, concurrency: 4, dryRun: false, model: "haiku" };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "limit" && value) args.limit = Number(value);
    else if (key === "source" && value) args.source = value;
    else if (key === "concurrency" && value) args.concurrency = Number(value);
    else if (key === "model" && value) args.model = value;
    else if (key === "dry-run") args.dryRun = true;
  }
  return args;
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function dedupe(apps: RawApp[]): RawApp[] {
  const seen = new Set<string>();
  const out: RawApp[] = [];
  for (const app of apps) {
    const key = slugify(app.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(app);
  }
  return out;
}

async function upsertTag(name: string): Promise<string> {
  const slug = slugify(name);
  const tag = await prisma.tag.upsert({ where: { slug }, create: { slug, name }, update: {} });
  return tag.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = args.source ? DATASOURCES.filter((s) => s.id === args.source) : DATASOURCES;
  if (sources.length === 0) {
    throw new Error(`No datasource matches "${args.source}". Available: ${DATASOURCES.map((s) => s.id).join(", ")}`);
  }

  console.log(`🌐 Fetching from ${sources.map((s) => s.id).join(", ")}…`);
  const fetched = (await Promise.all(sources.map((s) => s.fetch()))).flat();
  const apps = dedupe(fetched).slice(0, args.limit);
  console.log(`   ${fetched.length} fetched → ${apps.length} after dedupe/limit`);

  console.log(`🏷️  Tagging with claude -p (--model ${args.model}, concurrency ${args.concurrency})…`);
  let tagged = 0;
  const results = await mapWithConcurrency(apps, args.concurrency, async (app) => {
    const tags = await tagApp(app, args.model);
    tagged++;
    console.log(`  [${tagged}/${apps.length}] ${app.name}: ${tags.join(", ")}`);
    return { app, tags };
  });

  if (args.dryRun) {
    console.log("🧪 Dry run — no database writes.");
    return;
  }

  console.log("💾 Writing to database…");
  let created = 0;
  let updated = 0;
  for (const { app, tags } of results) {
    const slug = slugify(app.name);
    const existing = await prisma.app.findUnique({ where: { slug } });
    const record = await prisma.app.upsert({
      where: { slug },
      create: {
        slug,
        name: app.name,
        tagline: app.description.slice(0, 140),
        description: app.description,
        url: app.url,
        iconUrl: app.iconUrl,
        category: app.category,
        chain: "solana",
        status: "approved",
      },
      update: {
        tagline: app.description.slice(0, 140),
        description: app.description,
        url: app.url,
        iconUrl: app.iconUrl,
        category: app.category,
      },
    });
    if (existing) updated++;
    else created++;

    for (const tagName of tags) {
      const tagId = await upsertTag(tagName);
      await prisma.appTag.upsert({
        where: { appId_tagId: { appId: record.id, tagId } },
        create: { appId: record.id, tagId },
        update: {},
      });
    }
  }

  console.log(`✅ Live seed complete: ${created} created, ${updated} updated, ${apps.length} total apps.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
