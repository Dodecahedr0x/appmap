// Uses a local `claude -p` subprocess to find real apps matching a given
// tag, and appends whichever are new (deduped by URL against the existing
// list) to scripts/appData/apps.json — the same file
// scripts/createAppsOnchain.ts registers on-chain. This is the inverse of
// the deleted `seed-live/tagger.ts` (which tagged one already-known app);
// this finds apps for a known tag instead, but shells out to `claude -p`
// the same way (--tools "" --safe-mode: a fast, deterministic, non-agentic
// text completion, no skills/hooks/MCP overhead, no live web access — this
// only ever draws on the model's own knowledge, so results skew toward
// well-established, well-known products rather than very recent launches).
//
// Usage:
//   tsx scripts/discoverApps.ts --tag=productivity [--count=8] [--file=scripts/appData/apps.json] [--model=sonnet] [--effort=medium] [--dry-run]

import { readFileSync, writeFileSync } from "fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CATEGORIES, CHAINS } from "../src/lib/constants";
import { parseFlags } from "./lib/parseFlags";
import type { AppEntry } from "./createAppsOnchain";

const execFileAsync = promisify(execFile);

interface ClaudePrintResult {
  is_error: boolean;
  result: string;
}

export interface Args {
  tag: string;
  count: number;
  file: string;
  model: string;
  effort: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const f = parseFlags(argv);
  return {
    tag: typeof f.tag === "string" ? f.tag : "",
    count: typeof f.count === "string" ? Number(f.count) : 8,
    file: typeof f.file === "string" ? f.file : "scripts/appData/apps.json",
    model: typeof f.model === "string" ? f.model : "sonnet",
    effort: typeof f.effort === "string" ? f.effort : "medium",
    dryRun: Boolean(f["dry-run"]),
  };
}

/** Strips a leading `https://`/`http://`/`www.` and any trailing slash, so
 * near-identical URLs (`https://x.com` vs `http://www.x.com/`) dedupe as one. */
function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
}

function buildPrompt(tag: string, count: number, existingUrls: string[]): string {
  return [
    "You are helping grow nebulous.world, a crowd-sourced app discovery",
    "directory that lists apps/products/tools of ANY kind — not just Solana",
    "or crypto ones. Prefer real variety: web2 SaaS, dev tools, consumer",
    "apps, AI tools, other blockchain ecosystems, games, and so on.",
    "",
    `Suggest ${count} REAL, well-known, currently-operating apps or`,
    `products that would reasonably be tagged "${tag}". Every entry must be`,
    "a genuine, existing product with a real homepage URL — never invent one.",
    "",
    existingUrls.length > 0
      ? `Do not repeat any of these already-listed URLs:\n${existingUrls.join("\n")}`
      : "",
    "",
    "Reply with ONLY a JSON array, no prose, no markdown code fences, each",
    "element shaped exactly like this:",
    "{",
    '  "url": "https://example.com",',
    '  "name": "Example",',
    '  "tagline": "one short sentence",',
    '  "description": "one or two sentences, more detail than the tagline",',
    `  "category": one of ${JSON.stringify(CATEGORIES)},`,
    `  "chain": one of ${JSON.stringify(CHAINS)} — "web2" for anything with no blockchain,`,
    `  "tags": ["${tag}", "...1-3 more short lowercase kebab-case tags..."]`,
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Strip an optional ```json ... ``` fence and parse the remaining JSON array. */
function parseApps(raw: string): AppEntry[] {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = unfenced.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : unfenced;
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("discovery did not return an array");
  return parsed.filter(
    (a): a is AppEntry => a && typeof a === "object" && typeof a.url === "string" && typeof a.name === "string",
  );
}

/**
 * Ask a local `claude -p` subprocess for apps matching `tag`. Throws on
 * failure — unlike tagger.ts's per-app fallback, there's no sane default
 * app list to fall back to, so the caller just reports the tag as failed.
 */
async function discover(args: Args, existingUrls: string[]): Promise<AppEntry[]> {
  const prompt = buildPrompt(args.tag, args.count, existingUrls);
  const { stdout } = await execFileAsync(
    "claude",
    ["-p", prompt, "--output-format", "json", "--model", args.model, "--tools", "", "--effort", args.effort, "--safe-mode"],
    { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as ClaudePrintResult;
  if (parsed.is_error) throw new Error(parsed.result);
  return parseApps(parsed.result);
}

/**
 * One tag's worth of discovery against `existing`: asks the model, dedupes
 * the response by URL (against `existing` AND within the response itself),
 * and logs what it found. Shared by this script's `main()` (single tag) and
 * `extendAppList.ts` (many tags, one call per iteration) so the dedupe/
 * logging logic isn't duplicated between them.
 */
export async function discoverTag(
  args: Args,
  existing: AppEntry[],
): Promise<{ fresh: AppEntry[] }> {
  const existingUrls = new Set(existing.map((a) => normalizeUrl(a.url)));
  console.log(`🔎 Asking claude -p for apps tagged "${args.tag}" (model ${args.model})…`);
  const found = await discover(args, [...existingUrls]);

  const fresh: AppEntry[] = [];
  const seenThisRound = new Set<string>();
  for (const app of found) {
    const key = normalizeUrl(app.url);
    if (existingUrls.has(key) || seenThisRound.has(key)) continue;
    seenThisRound.add(key);
    fresh.push(app);
  }

  console.log(`   ${found.length} suggested, ${fresh.length} new (rest already listed or duplicated)`);
  for (const app of fresh) {
    console.log(`  + ${app.name} — ${app.url} [${app.tags?.join(", ") ?? ""}]`);
  }
  return { fresh };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tag) throw new Error("--tag=<tag> is required");

  const existing = JSON.parse(readFileSync(args.file, "utf-8")) as AppEntry[];
  const { fresh } = await discoverTag(args, existing);

  if (fresh.length === 0) {
    console.log("Nothing new to add.");
    return;
  }

  if (args.dryRun) {
    console.log(`🧪 Dry run — not writing to ${args.file}`);
    return;
  }

  const merged = [...existing, ...fresh];
  writeFileSync(args.file, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`✅ Appended ${fresh.length} app(s) to ${args.file} (${merged.length} total)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
