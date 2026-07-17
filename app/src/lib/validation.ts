import { z } from "zod";

// Shared request validation schemas.

export const submitAppSchema = z.object({
  name: z.string().min(2).max(80),
  url: z.string().url().max(300),
  tagline: z.string().max(140).optional().default(""),
  description: z.string().max(4000).optional().default(""),
  iconUrl: z.string().url().max(300).optional().or(z.literal("")),
  category: z.string().min(1).max(40).optional().default("other"),
  chain: z.string().min(1).max(40).optional().default("solana"),
  tags: z.array(z.string().min(1).max(40)).max(10).optional().default([]),
});
export type SubmitAppInput = z.infer<typeof submitAppSchema>;

export const voteSchema = z.object({
  appId: z.string().min(1),
  amount: z.number().positive().max(1_000_000_000),
  txSig: z.string().min(32).max(128).optional(),
});

export const suggestTagSchema = z.object({
  appId: z.string().min(1),
  tag: z.string().min(1).max(40),
});

export const stakeSchema = z.object({
  appTagId: z.string().min(1),
  amount: z.number().positive().max(1_000_000_000),
  txSig: z.string().min(32).max(128).optional(),
});

export const unstakeSchema = z.object({
  stakeId: z.string().min(1),
});

export const unvoteSchema = z.object({
  voteId: z.string().min(1),
});

export const trackViewSchema = z.object({
  appId: z.string().min(1),
  path: z.string().max(300).optional().default("/"),
  referrer: z.string().max(300).optional(),
  turnstileToken: z.string().nullable().optional(),
});

export const authVerifySchema = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(32).max(200),
  nonce: z.string().min(8),
  message: z.string().min(8).max(1000),
});

// Filters are either onchain (tags, and the token stake behind them) or
// offchain (OpenGraph-derived text: name/tagline/description) — there is no
// separate "category" taxonomy on the search API.
const intFilter = () => z.coerce.number().int().min(0).optional();

export const searchSchema = z.object({
  q: z.string().max(120).optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  fuzzy: z.string().max(120).optional().default(""),
  appStakeMin: intFilter(),
  appStakeMax: intFilter(),
  tagsStakeMin: intFilter(),
  tagsStakeMax: intFilter(),
  tagsCountMin: intFilter(),
  tagsCountMax: intFilter(),
  pageviewsMin: intFilter(),
  pageviewsMax: intFilter(),
  sort: z.enum(["rank", "votes", "stake", "traffic", "new"]).optional().default("rank"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type SearchInput = z.infer<typeof searchSchema>;
