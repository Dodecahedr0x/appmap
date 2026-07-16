// Ranking engine.
//
// The rank score blends four signals, each log-dampened so that no single
// whale (huge vote or stake) can completely dominate the ordering, plus a
// freshness bonus that fades over time so newly-submitted quality apps can
// surface. All weights live here so ranking behaviour is easy to tune and test.

export const RANK_WEIGHTS = {
  /** Weight of token-weighted votes. */
  vote: 1.0,
  /** Weight of total tokens staked across the app's tags. */
  stake: 0.8,
  /** Weight of lifetime traffic (page views). */
  traffic: 0.35,
  /** Peak bonus applied to a brand-new app, decaying with a half-life. */
  freshnessBonus: 1.5,
  /** Half-life of the freshness bonus, in days. */
  freshnessHalfLifeDays: 14,
} as const;

export interface RankInputs {
  /** Sum of token-weighted votes. */
  voteWeight: number;
  /** Total active stake across all of the app's tags. */
  stakeTotal: number;
  /** Lifetime page views. */
  viewCount: number;
  /** Age of the app in days (now - createdAt). */
  ageDays: number;
}

/**
 * Compute the ranking score for an app. Higher is better. Pure function.
 */
export function computeRankScore(inputs: RankInputs): number {
  const { voteWeight, stakeTotal, viewCount, ageDays } = inputs;
  const w = RANK_WEIGHTS;

  const voteScore = w.vote * log10p1(voteWeight);
  const stakeScore = w.stake * log10p1(stakeTotal);
  const trafficScore = w.traffic * log10p1(viewCount);

  const decay = Math.pow(0.5, Math.max(0, ageDays) / w.freshnessHalfLifeDays);
  const freshness = w.freshnessBonus * decay;

  const score = voteScore + stakeScore + trafficScore + freshness;
  // Round to avoid float noise causing unstable ordering across recomputes.
  return round(score, 6);
}

/** log10(1 + x), guarding against negatives. */
function log10p1(x: number): number {
  return Math.log10(1 + Math.max(0, x));
}

function round(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Combine a text-relevance score (0..1) with a normalised rank score to produce
 * a final search ordering score. `textScore` of 0 means "no text query", in
 * which case ordering is purely by rank.
 */
export function combineSearchScore(
  textScore: number,
  rankScore: number,
  maxRankScore: number,
): number {
  const normalizedRank = maxRankScore > 0 ? rankScore / maxRankScore : 0;
  if (textScore <= 0) return normalizedRank;
  // Text relevance dominates, rank breaks ties / boosts among matches.
  return textScore * 0.7 + normalizedRank * 0.3;
}

export function ageInDays(createdAt: Date, now: Date = new Date()): number {
  return (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
}
