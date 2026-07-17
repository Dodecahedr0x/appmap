import type { Ad } from "@prisma/client";

/**
 * Weighted random selection of an ad. Each ad's `weight` scales its probability
 * of being served. Pure function so it can be unit tested with an injected RNG.
 */
export function pickWeightedAd(
  ads: Ad[],
  rng: () => number = Math.random,
): Ad | null {
  const active = ads.filter((a) => a.active && a.weight > 0);
  if (active.length === 0) return null;
  const total = active.reduce((s, a) => s + a.weight, 0);
  let r = rng() * total;
  for (const ad of active) {
    r -= ad.weight;
    if (r <= 0) return ad;
  }
  return active[active.length - 1]!;
}
