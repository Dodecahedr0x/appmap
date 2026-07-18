// Grows scripts/appData/apps.json by running discoverApps.ts's discovery
// round across multiple categories in one invocation, instead of having to
// manually pick and re-run --tag= by hand for each one. Each iteration
// targets whichever category is currently least represented in the file (so
// repeated runs fill gaps rather than piling onto whatever's already
// biggest), and — like discoverApps.ts — tells the model every URL already
// listed, so the *same* invocation run again later keeps surfacing apps
// that aren't in the file yet instead of the same well-known handful.
//
// Usage:
//   tsx scripts/extendAppList.ts --iterations=10 [--count=8] [--file=scripts/appData/apps.json] [--model=sonnet] [--effort=medium] [--dry-run]

import { readFileSync, writeFileSync } from "fs";
import { CATEGORIES, type Category } from "../src/lib/constants";
import { parseFlags } from "./lib/parseFlags";
import { discoverTag } from "./discoverApps";
import type { AppEntry } from "./createAppsOnchain";

// A few candidate seed tags per category, so consecutive iterations landing
// on the same (least-populated) category don't always ask the model for the
// exact same word.
const CATEGORY_TAGS: Record<Category, string[]> = {
  defi: ["defi", "lending", "yield"],
  nft: ["nft", "nft-marketplace", "collectibles"],
  gaming: ["gaming", "web3-gaming", "play-to-earn"],
  dao: ["dao", "governance", "on-chain-voting"],
  infrastructure: ["infrastructure", "rpc", "indexing"],
  wallet: ["wallet", "custody", "multisig"],
  social: ["social", "messaging", "community"],
  payments: ["payments", "remittance", "checkout"],
  analytics: ["analytics", "dashboards", "on-chain-data"],
  "developer-tools": ["developer-tools", "sdk", "testing"],
  marketplace: ["marketplace", "commerce", "auctions"],
  other: ["productivity", "ai-tools", "utilities"],
};

interface Args {
  iterations: number;
  count: number;
  file: string;
  model: string;
  effort: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const f = parseFlags(argv);
  return {
    iterations: typeof f.iterations === "string" ? Number(f.iterations) : 5,
    count: typeof f.count === "string" ? Number(f.count) : 8,
    file: typeof f.file === "string" ? f.file : "scripts/appData/apps.json",
    model: typeof f.model === "string" ? f.model : "sonnet",
    effort: typeof f.effort === "string" ? f.effort : "medium",
    dryRun: Boolean(f["dry-run"]),
  };
}

/** The category with the fewest entries in `entries` so far — ties broken by CATEGORIES order. */
function leastRepresentedCategory(entries: AppEntry[]): Category {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const e of entries) {
    if (e.category && e.category in counts) counts[e.category as Category]++;
  }
  return CATEGORIES.reduce((min, c) => (counts[c] < counts[min] ? c : min), CATEGORIES[0]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!(args.iterations > 0)) throw new Error("--iterations must be a positive number");

  let entries = JSON.parse(readFileSync(args.file, "utf-8")) as AppEntry[];
  console.log(`📦 Starting from ${entries.length} app(s) in ${args.file}`);

  let totalFresh = 0;
  for (let i = 1; i <= args.iterations; i++) {
    const category = leastRepresentedCategory(entries);
    const tags = CATEGORY_TAGS[category];
    const tag = tags[Math.floor(Math.random() * tags.length)]!;

    console.log(`\n[${i}/${args.iterations}] category "${category}" → tag "${tag}"`);
    const { fresh } = await discoverTag(
      { tag, count: args.count, file: args.file, model: args.model, effort: args.effort, dryRun: args.dryRun },
      entries,
    );
    if (fresh.length === 0) continue;

    entries = [...entries, ...fresh];
    totalFresh += fresh.length;
    if (!args.dryRun) {
      writeFileSync(args.file, `${JSON.stringify(entries, null, 2)}\n`);
    }
  }

  console.log(
    `\n${args.dryRun ? "🧪 Dry run — " : "✅ "}Added ${totalFresh} app(s) across ${args.iterations} iteration(s); ${entries.length} total in ${args.file}.`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
