// A tiny standalone admin UI for curating scripts/appData/apps.json before
// it's pushed on-chain (see scripts/createAppsOnchain.ts): a Review tab to
// add/remove tags on apps already in the list, and an Expand tab that
// reuses discoverApps.ts's `discoverTag` to find a new cluster of apps via
// a local `claude -p` subprocess, letting a human approve/reject/edit
// before anything is written to disk. Plain node:http + vanilla HTML/JS —
// no framework, since this is a one-off local tool, not a shipped product
// surface (see AGENTS.md's general "avoid unneeded deps" lean).
//
// Usage:
//   tsx --env-file=.env scripts/apps-curator/server.ts [--port=4400] [--file=scripts/appData/apps.json]

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFlags } from "../lib/parseFlags";
import { discoverTag, type Args as DiscoverArgs } from "../discoverApps";
import type { AppEntry } from "../createAppsOnchain";

const flags = parseFlags(process.argv.slice(2));
const PORT = typeof flags.port === "string" ? Number(flags.port) : 4400;
const APPS_FILE =
  typeof flags.file === "string" ? flags.file : path.join(__dirname, "..", "appData", "apps.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Serializes every read-modify-write against APPS_FILE so two
// near-simultaneous requests (a double-click, two browser tabs) can't race
// and clobber each other's edit. A simple in-process promise chain is
// enough for a single-operator local tool — no file locking or database
// needed. `.then(fn, fn)` (not just `.then(fn)`) so a PREVIOUS operation's
// rejection doesn't leave the queue permanently stuck; `writeQueue` itself
// swallows the rejection (via the trailing `.catch`) so it doesn't count as
// an unhandled rejection, while `result` — what callers actually get back —
// still rejects with the real error for its own caller to handle.
let writeQueue: Promise<unknown> = Promise.resolve();
function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.catch(() => {});
  return result;
}

async function readApps(): Promise<AppEntry[]> {
  const raw = await readFile(APPS_FILE, "utf-8");
  return JSON.parse(raw) as AppEntry[];
}

async function writeApps(apps: AppEntry[]): Promise<void> {
  await writeFile(APPS_FILE, `${JSON.stringify(apps, null, 2)}\n`);
}

/** Same normalization discoverApps.ts's dedup uses — kept in sync by hand
    since this is a small, stable, copy-once helper, not worth a shared
    module for one three-line function. */
function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------
// Tiny request helpers — no framework, so these stand in for what
// express.json()/res.json() would normally give you.
// ---------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function serveStatic(res: ServerResponse, filePath: string) {
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

async function handleGetApps(res: ServerResponse) {
  const apps = await readApps();
  sendJson(res, 200, { apps });
}

/** Full replacement of one app's `tags` array — simpler and less error-prone
    than separate add/remove endpoints, since the client (which already
    renders the current chip list) always knows the full desired set. */
async function handlePatchAppTags(req: IncomingMessage, res: ServerResponse, encodedUrl: string) {
  const targetUrl = decodeURIComponent(encodedUrl);
  const body = await readJsonBody<{ tags: unknown }>(req);
  if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string")) {
    sendJson(res, 400, { error: "tags must be an array of strings" });
    return;
  }
  await withFileLock(async () => {
    const apps = await readApps();
    const target = apps.find((a) => normalizeUrl(a.url) === normalizeUrl(targetUrl));
    if (!target) {
      sendJson(res, 404, { error: "app not found" });
      return;
    }
    // Dedup + drop empties — a chip UI can easily produce "" or repeats.
    target.tags = [...new Set((body.tags as string[]).map((t) => t.trim()).filter(Boolean))];
    await writeApps(apps);
    sendJson(res, 200, { app: target });
  });
}

/** Runs discovery and hands the candidates back for review — never writes
    to apps.json itself (discoverTag doesn't either); see handleApprove for
    the write step, which only happens once a human has looked. */
async function handleDiscover(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody<{ tag?: string; count?: number; model?: string; effort?: string }>(req);
  const tag = (body.tag ?? "").trim();
  if (!tag) {
    sendJson(res, 400, { error: "tag is required" });
    return;
  }
  const args: DiscoverArgs = {
    tag,
    count: body.count && body.count > 0 ? Math.min(Math.floor(body.count), 25) : 8,
    file: APPS_FILE,
    model: body.model || "sonnet",
    effort: body.effort || "medium",
    dryRun: true,
  };
  try {
    const existing = await readApps();
    const { fresh } = await discoverTag(args, existing);
    sendJson(res, 200, { apps: fresh });
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : "discovery failed" });
  }
}

/** Appends the user-approved (and possibly hand-edited) candidates. Re-checks
    dedup against the file's CURRENT state, not whatever it was when the user
    started reviewing — another tab, or someone else, may have added the
    same app in the meantime. */
async function handleApprove(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody<{ apps?: AppEntry[] }>(req);
  const candidates = Array.isArray(body.apps) ? body.apps : [];
  const valid = candidates.filter(
    (a): a is AppEntry => Boolean(a) && typeof a.url === "string" && a.url.trim().length > 0,
  );
  if (valid.length === 0) {
    sendJson(res, 400, { error: "apps must be a non-empty array of {url, ...}" });
    return;
  }

  await withFileLock(async () => {
    const existing = await readApps();
    const existingUrls = new Set(existing.map((a) => normalizeUrl(a.url)));
    const toAdd = valid.filter((a) => !existingUrls.has(normalizeUrl(a.url)));
    const merged = [...existing, ...toAdd];
    await writeApps(merged);
    sendJson(res, 200, { added: toAdd.length, skipped: valid.length - toAdd.length, total: merged.length });
  });
}

// ---------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/apps") {
      await handleGetApps(res);
      return;
    }
    if (req.method === "PATCH" && url.pathname.startsWith("/api/apps/")) {
      await handlePatchAppTags(req, res, url.pathname.slice("/api/apps/".length));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/discover") {
      await handleDiscover(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/discover/approve") {
      await handleApprove(req, res);
      return;
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      // No ".." traversal — this only ever serves the small fixed set of
      // files in public/, never an arbitrary path.
      if (rel.includes("..")) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }
      await serveStatic(res, path.join(PUBLIC_DIR, rel));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => {
  const apps = JSON.parse(readFileSync(APPS_FILE, "utf-8")) as AppEntry[];
  console.log(`📋 apps-curator running at http://localhost:${PORT} (${apps.length} apps in ${APPS_FILE})`);
});
