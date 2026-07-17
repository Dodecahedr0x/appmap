import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawApp } from "./types";

const execFileAsync = promisify(execFile);

interface ClaudePrintResult {
  is_error: boolean;
  result: string;
}

function buildPrompt(app: RawApp): string {
  return [
    "You are tagging an app directory for a Solana ecosystem discovery site.",
    "Given the app below, reply with ONLY a JSON array of 2-5 short, lowercase,",
    "kebab-case tags (e.g. \"dex\", \"liquid-staking\", \"nft-marketplace\") that",
    "best describe what it does. No prose, no markdown code fences.",
    "",
    `Name: ${app.name}`,
    `Category: ${app.category}`,
    `Description: ${app.description}`,
  ].join("\n");
}

/** Strip an optional ```json ... ``` fence and parse the remaining JSON array. */
function parseTags(raw: string): string[] {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = unfenced.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : unfenced;
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("tagger did not return an array");
  return parsed
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * Ask a local `claude -p` subprocess to tag a single app. Runs with --tools ""
 * and --safe-mode so it's a fast, deterministic, non-agentic text completion
 * rather than a full interactive session (no skills/hooks/MCP overhead).
 * Falls back to [app.category] on any failure so one bad call can't abort the seed.
 */
export async function tagApp(app: RawApp, model = "haiku"): Promise<string[]> {
  const prompt = buildPrompt(app);
  try {
    const { stdout } = await execFileAsync(
      "claude",
      ["-p", prompt, "--output-format", "json", "--model", model, "--tools", "", "--effort", "low", "--safe-mode"],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as ClaudePrintResult;
    if (parsed.is_error) throw new Error(parsed.result);
    return parseTags(parsed.result);
  } catch (err) {
    console.warn(`  ⚠ tagging failed for "${app.name}", falling back to [${app.category}]:`, (err as Error).message);
    return [app.category];
  }
}
