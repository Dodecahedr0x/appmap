// Fills in icon/tagline/description for existing apps that are missing them,
// using each app's own OpenGraph metadata (see src/lib/opengraph.ts). Safe to
// re-run — only touches apps still missing at least one of those fields.
//
// Usage:
//   tsx scripts/backfillOpengraph.ts [--limit=200] [--concurrency=5] [--dry-run]

import { fetchAppsMissingMetadata, updateAppMetadata } from "../src/lib/indexerClient";
import { enrichWithOpenGraph } from "../src/lib/opengraph";
import { mapWithConcurrency } from "./lib/concurrency";
import { parseFlags } from "./lib/parseFlags";

interface Args {
  limit: number;
  concurrency: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const f = parseFlags(argv);
  return {
    limit: typeof f.limit === "string" ? Number(f.limit) : 200,
    concurrency: typeof f.concurrency === "string" ? Number(f.concurrency) : 5,
    dryRun: Boolean(f["dry-run"]),
  };
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
