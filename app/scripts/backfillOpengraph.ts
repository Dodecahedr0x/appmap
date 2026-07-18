// Fills in icon/tagline/description for existing apps that are missing them,
// using each app's own OpenGraph metadata (see src/lib/opengraph.ts). Safe to
// re-run — only touches apps still missing at least one of those fields.
//
// Usage:
//   tsx scripts/backfillOpengraph.ts [--limit=200] [--concurrency=5] [--dry-run]

import { fetchAppsMissingMetadata, updateAppMetadata } from "../src/lib/indexerClient";
import { enrichWithOpenGraph } from "../src/lib/opengraph";

interface Args {
  limit: number;
  concurrency: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 200, concurrency: 5, dryRun: false };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "limit" && value) args.limit = Number(value);
    else if (key === "concurrency" && value) args.concurrency = Number(value);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apps = (await fetchAppsMissingMetadata()).slice(0, args.limit);

  if (apps.length === 0) {
    console.log("Nothing to backfill — every app already has icon/tagline/description.");
    return;
  }
  console.log(`🔎 ${apps.length} app(s) missing icon/tagline/description (concurrency ${args.concurrency})…`);

  let filled = 0;
  let unchanged = 0;
  await mapWithConcurrency(apps, args.concurrency, async (app) => {
    const enriched = await enrichWithOpenGraph(app);
    const changed =
      enriched.iconUrl !== app.iconUrl ||
      enriched.tagline !== app.tagline ||
      enriched.description !== app.description;

    if (!changed) {
      unchanged++;
      console.log(`  – ${app.slug}: no OpenGraph data found`);
      return;
    }

    filled++;
    console.log(`  ✓ ${app.slug}: ${[
      enriched.iconUrl !== app.iconUrl && "icon",
      enriched.tagline !== app.tagline && "tagline",
      enriched.description !== app.description && "description",
    ].filter(Boolean).join(", ")}`);

    if (!args.dryRun) {
      await updateAppMetadata(app.id, enriched);
    }
  });

  console.log(
    `${args.dryRun ? "🧪 Dry run — " : "✅ "}${filled} app(s) enriched, ${unchanged} left unchanged.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
