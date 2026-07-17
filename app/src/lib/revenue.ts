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

export const APP_TAG_SPLIT = 0.5;

export interface AppRevenueSplit {
  /** The original combined gross revenue passed in. */
  gross: number;
  /** Protocol fee taken once, on the combined gross, before the 50/50 split. */
  protocolFee: number;
  votePool: DistributionResult;
  tagPool: DistributionResult;
}

/**
 * Split an app's gross ad revenue between its direct (vote) stakers and its
 * tags' stakers. The protocol fee is taken once, up front, on the combined
 * gross — then the remainder is split 50/50 between the two pools. If one
 * side has no active positions, its half rolls into the other side instead
 * of being stranded.
 *
 * Note: `votePool.gross`/`tagPool.gross` on the inner `DistributionResult`s
 * are each pool's post-fee share of the split, not this app's total gross
 * revenue — use the top-level `gross`/`protocolFee` fields for that.
 */
export function distributeAppRevenue(
  gross: number,
  positions: { votePositions: StakePosition[]; tagPositions: StakePosition[] },
  feeRate: number = REVENUE_CONFIG.protocolFee,
): AppRevenueSplit {
  const safeGross = Math.max(0, gross);
  const fee = round(safeGross * clamp(feeRate, 0, 1), 9);
  const distributable = round(safeGross - fee, 9);

  const hasVoters = positions.votePositions.some((p) => p.stake > 0);
  const hasTaggers = positions.tagPositions.some((p) => p.stake > 0);

  let voteShare = round(distributable * APP_TAG_SPLIT, 9);
  let tagShare = round(distributable - voteShare, 9);

  if (!hasTaggers) {
    voteShare = distributable;
    tagShare = 0;
  } else if (!hasVoters) {
    tagShare = distributable;
    voteShare = 0;
  }

  // distributeRevenue applies its own fee internally; pass feeRate=0 since the
  // fee was already taken above on the combined gross.
  const votePool = distributeRevenue(voteShare, positions.votePositions, 0);
  const tagPool = distributeRevenue(tagShare, positions.tagPositions, 0);

  return { gross: safeGross, protocolFee: fee, votePool, tagPool };
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
