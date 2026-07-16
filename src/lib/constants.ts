// Shared enumerations and option lists used across the app. Kept as plain
// string constants because SQLite (dev) does not support native enums.

export const AppStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  FLAGGED: "flagged",
} as const;
export type AppStatus = (typeof AppStatus)[keyof typeof AppStatus];

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
  { value: "votes", label: "Most votes" },
  { value: "stake", label: "Most staked" },
  { value: "traffic", label: "Most traffic" },
  { value: "new", label: "Newest" },
] as const;

/** Human-readable token symbol for the vote/stake token. */
export const TOKEN_SYMBOL = "APP";
