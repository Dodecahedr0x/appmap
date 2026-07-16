// Revenue distribution engine.
//
// Ad revenue earned by an app's page (its traffic) during a settlement epoch is
// distributed to everyone who has staked on that app — across all of the app's
// tags — in proportion to how much they staked. A protocol fee is skimmed for
// the treasury first. All functions here are pure so the split can be unit
// tested independently of the database.

export const REVENUE_CONFIG = {
  /** Fraction of gross revenue retained by the protocol treasury. */
  protocolFee: 0.1,
} as const;

export interface StakePosition {
  /** Wallet / user id of the staker. */
  userId: string;
  /** The staker's total active stake on the app (summed across tags). */
  stake: number;
}

export interface RevenueShare {
  userId: string;
  /** Amount of the epoch's revenue this staker earned. */
  amount: number;
  /** The staker's proportion of the total stake pool (0..1). */
  shareOfPool: number;
}

export interface DistributionResult {
  gross: number;
  protocolFee: number;
  distributable: number;
  totalStake: number;
  shares: RevenueShare[];
  /** Revenue that could not be distributed (e.g. no stakers) and is retained. */
  undistributed: number;
}

/**
 * Split `gross` ad revenue among `positions` proportional to stake.
 *
 * - A protocol fee is taken from the gross first.
 * - The remainder is divided pro-rata by stake weight.
 * - If there are no active stakers, the distributable amount is returned as
 *   `undistributed` (it should be retained by the treasury until stakers exist).
 */
export function distributeRevenue(
  gross: number,
  positions: StakePosition[],
  feeRate: number = REVENUE_CONFIG.protocolFee,
): DistributionResult {
  const safeGross = Math.max(0, gross);
  const fee = round(safeGross * clamp(feeRate, 0, 1), 9);
  const distributable = round(safeGross - fee, 9);

  const active = positions.filter((p) => p.stake > 0);
  const totalStake = active.reduce((sum, p) => sum + p.stake, 0);

  if (totalStake <= 0 || distributable <= 0) {
    return {
      gross: safeGross,
      protocolFee: fee,
      distributable,
      totalStake,
      shares: [],
      undistributed: distributable,
    };
  }

  // Aggregate by user in case the same user appears more than once.
  const byUser = new Map<string, number>();
  for (const p of active) {
    byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + p.stake);
  }

  let allocated = 0;
  const shares: RevenueShare[] = [];
  const entries = [...byUser.entries()];
  entries.forEach(([userId, stake], i) => {
    const shareOfPool = stake / totalStake;
    // Give the last staker the remainder so the sum exactly equals
    // `distributable` (avoids rounding dust being lost or created).
    const isLast = i === entries.length - 1;
    const amount = isLast
      ? round(distributable - allocated, 9)
      : round(distributable * shareOfPool, 9);
    allocated = round(allocated + amount, 9);
    shares.push({ userId, amount, shareOfPool: round(shareOfPool, 9) });
  });

  return {
    gross: safeGross,
    protocolFee: fee,
    distributable,
    totalStake,
    shares,
    undistributed: 0,
  };
}

/**
 * Compute the revenue value credited for a single ad impression given a CPM
 * (revenue per 1000 impressions).
 */
export function revenuePerImpression(cpm: number): number {
  return round(Math.max(0, cpm) / 1000, 9);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}
