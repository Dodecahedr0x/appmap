// Shared enumerations and option lists used across the app. Kept as plain
// string constants because SQLite (dev) does not support native enums.

export const CATEGORIES = [
  "defi",
  "nft",
  "gaming",
  "dao",
  "infrastructure",
  "wallet",
  "social",
  "payments",
  "analytics",
  "developer-tools",
  "marketplace",
  "productivity",
  "design",
  "ai",
  "entertainment",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CHAINS = [
  "solana",
  "ethereum",
  "base",
  "polygon",
  "bitcoin",
  "aptos",
  "sui",
  "web2",
] as const;
export type Chain = (typeof CHAINS)[number];

export const SORT_OPTIONS = [
  { value: "rank", label: "Top ranked" },
  { value: "trending_week", label: "Trending (week)" },
  { value: "trending_month", label: "Trending (month)" },
  { value: "votes", label: "Most votes" },
  { value: "stake", label: "Most staked" },
  { value: "traffic", label: "Most traffic" },
  { value: "new", label: "Newest" },
] as const;

/** In any grid/list of apps, show one sponsored AdCard after every N app cards. */
export const AD_EVERY_N_APPS = 6;

/** Human-readable token symbol for the vote/stake/sale token. */
export const TOKEN_SYMBOL = "NEB";

/** Full name of the token, for prose/page copy (TOKEN_SYMBOL for inline amounts). */
export const TOKEN_NAME = "Nebula";

/** Public site name, used for OpenGraph og:site_name and page titles. */
export const SITE_NAME = "nebulous.world";

/** Public tagline, used as the default OpenGraph/Twitter description. */
export const SITE_DESCRIPTION =
  "Crowd-sourced app discovery with advanced search, Solana-powered voting, tag staking, and traffic-based ad revenue sharing.";

/** Canonical site origin, used for metadataBase and absolute OG/canonical URLs. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/$/, "");

/** GitHub repo — linked from the footer. */
export const SITE_GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/Dodecahedr0x/appmap";

/** Twitter/X profile — linked from the footer. */
export const SITE_TWITTER_URL =
  process.env.NEXT_PUBLIC_TWITTER_URL || "https://x.com/Dodecahedr0x";

/**
 * Docs site (see docs-site/, a statically-generated Mintlify build deployed
 * as its own Render static site — see render.yaml's
 * nebulous-world-docs service and docs-site/README.md). Defaults to that
 * service's onrender.com URL, matching every other service name in
 * render.yaml; override once a custom docs domain is attached.
 */
export const SITE_DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL || "https://nebulous-world-docs.onrender.com";
