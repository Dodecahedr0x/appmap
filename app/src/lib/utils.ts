import { clsx, type ClassValue } from "clsx";
import type { TagDTO } from "./types";

/** Tailwind-friendly className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Convert an arbitrary string into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Shorten a base58 address for display: "9xQe…3kf2". */
export function shortAddress(addr: string, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 1) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

/** Format a token amount with thousands separators and sensible precision. */
export function formatToken(amount: number, symbol = "NEB"): string {
  const abs = Math.abs(amount);
  let str: string;
  if (abs >= 1_000_000) str = (amount / 1_000_000).toFixed(2) + "M";
  else if (abs >= 1_000) str = (amount / 1_000).toFixed(2) + "K";
  else if (abs >= 1) str = amount.toFixed(2);
  else str = amount.toPrecision(3);
  return symbol ? `${str} ${symbol}` : str;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** Extract a display-friendly hostname from a URL: "https://www.jup.ag/x" -> "jup.ag". */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The app's tag with the most stake behind it, or null if it has no tags
    at all — apps have no onchain "category", so this is what stands in for
    one anywhere a card previously showed `app.category`. */
export function topStakedTag(tags: TagDTO[]): TagDTO | null {
  if (tags.length === 0) return null;
  return tags.reduce((top, t) => (t.stakeTotal > top.stakeTotal ? t : top));
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count}${label} ago`;
  }
  return "just now";
}
