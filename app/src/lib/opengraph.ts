// Best-effort fetch of a page's OpenGraph metadata (image/title/description),
// used to auto-fill app presentation (icon, tagline, description) from the
// app's own site when the submitter didn't supply them. Never throws — a
// failed or slow fetch just means falling back to whatever the app already has.

export interface OpenGraphData {
  imageUrl?: string;
  title?: string;
  description?: string;
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1_000_000; // enough for <head>; avoids reading huge bodies

function metaContent(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    // Group 1 is the quote character (captured so the content group can stop
    // at a matching close-quote instead of any quote char — content often
    // legitimately contains an apostrophe, e.g. "Solana's ...").
    const match = pattern.exec(html);
    if (match?.[2] !== undefined) return match[2].trim();
  }
  return undefined;
}

// Matches both attribute orders: <meta property="og:x" content="..."> and
// <meta content="..." property="og:x">. The content-value group uses [^>]
// rather than `.` — `.` matches `>`, which let non-greedy backtracking skip
// past this tag's boundary and capture into a *later* meta tag whenever an
// earlier candidate closing-quote didn't satisfy the rest of the pattern
// (e.g. a preceding <meta name="description"> sitting right before the
// og:image tag, as real pages commonly emit with no whitespace between tags).
function metaPatterns(key: string): RegExp[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=(["'])([^>]*?)\\1`, "i"),
    new RegExp(`<meta[^>]+content=(["'])([^>]*?)\\1[^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

async function readHead(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) break;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

/**
 * Fetch `pageUrl` and extract its OpenGraph (falling back to Twitter card)
 * metadata. Returns null on any network error, non-HTML response, or
 * timeout — callers should treat this as "no data available", not an error.
 */
export async function fetchOpenGraph(pageUrl: string): Promise<OpenGraphData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; AppMapBot/1.0; +https://appmap)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const html = await readHead(res, MAX_HTML_BYTES);

    const rawImage = metaContent(html, [...metaPatterns("og:image"), ...metaPatterns("twitter:image")]);
    const rawTitle = metaContent(html, [...metaPatterns("og:title"), ...metaPatterns("twitter:title")]);
    const rawDescription = metaContent(html, [
      ...metaPatterns("og:description"),
      ...metaPatterns("twitter:description"),
    ]);

    const data: OpenGraphData = {};
    if (rawImage) {
      try {
        data.imageUrl = new URL(decodeEntities(rawImage), res.url).toString();
      } catch {
        // malformed image URL — omit rather than fail the whole fetch
      }
    }
    if (rawTitle) data.title = decodeEntities(rawTitle);
    if (rawDescription) data.description = decodeEntities(rawDescription);

    return Object.keys(data).length > 0 ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Keep in sync with buildCreateAppTxSchema's tagline/description limits (src/lib/validation.ts).
const TAGLINE_MAX = 140;
const DESCRIPTION_MAX = 4000;

export interface EnrichableApp {
  url: string;
  iconUrl?: string | null;
  tagline?: string | null;
  description?: string | null;
}

export interface EnrichedAppFields {
  iconUrl: string | null;
  tagline: string;
  description: string;
}

/**
 * Fill in whichever of iconUrl/tagline/description the app is missing using
 * its own OpenGraph metadata. Fields the app already has always win over
 * scraped ones; only fetches when at least one field is missing.
 */
export async function enrichWithOpenGraph(app: EnrichableApp): Promise<EnrichedAppFields> {
  const iconUrl = app.iconUrl ?? null;
  const tagline = app.tagline ?? "";
  const description = app.description ?? "";

  if (iconUrl && tagline && description) {
    return { iconUrl, tagline, description };
  }

  const og = await fetchOpenGraph(app.url);
  return {
    iconUrl: iconUrl || og?.imageUrl || null,
    tagline: tagline || (og?.title ?? "").slice(0, TAGLINE_MAX),
    description: description || (og?.description ?? "").slice(0, DESCRIPTION_MAX),
  };
}
