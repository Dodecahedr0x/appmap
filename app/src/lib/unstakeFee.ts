// Mirrors programs/nebulous_world/src/unstake_fee.rs and constants.rs exactly
// (same values, same linear-decay formula) — client-side only for showing an
// ESTIMATE before a user withdraws; the real fee is always computed on-chain
// by withdraw_vote/withdraw_tag_stake at execution time, this never enforces
// anything. Keep the constants in sync with the Rust source if either ever
// changes.

/** 100 bps = 1% — see UNSTAKE_FEE_START_BPS in constants.rs. */
export const UNSTAKE_FEE_START_BPS = 100;

/** One week, in seconds — see UNSTAKE_FEE_DECAY_SECONDS in constants.rs. */
export const UNSTAKE_FEE_DECAY_SECONDS = 7 * 24 * 60 * 60;

/**
 * Fee bps at `elapsedSecs` since a position's `stakedAt` checkpoint — see
 * `linear_decay_fee_bps` in unstake_fee.rs for the on-chain source of truth
 * this mirrors.
 */
export function linearDecayFeeBps(elapsedSecs: number): number {
  if (elapsedSecs <= 0) return UNSTAKE_FEE_START_BPS;
  if (elapsedSecs >= UNSTAKE_FEE_DECAY_SECONDS) return 0;
  const remainingSecs = UNSTAKE_FEE_DECAY_SECONDS - elapsedSecs;
  return Math.floor((UNSTAKE_FEE_START_BPS * remainingSecs) / UNSTAKE_FEE_DECAY_SECONDS);
}

export interface UnstakeFeeEstimate {
  feeBps: number;
  /** In the same UI-unit scale as `amount` (not raw on-chain units). */
  fee: number;
  net: number;
}

/**
 * Estimates the unstake fee on `amount` (UI units, e.g. from `formatToken`'s
 * input scale) for a position last checkpointed at `stakedAtUnixSeconds`
 * (the indexer-provided `PositionData.stakedAt`). `nowUnixSeconds` defaults
 * to the caller's wall clock — overridable for tests.
 */
export function estimateUnstakeFee(
  amount: number,
  stakedAtUnixSeconds: number,
  nowUnixSeconds: number = Date.now() / 1000,
): UnstakeFeeEstimate {
  const elapsedSecs = nowUnixSeconds - stakedAtUnixSeconds;
  const feeBps = linearDecayFeeBps(elapsedSecs);
  const fee = (amount * feeBps) / 10_000;
  return { feeBps, fee, net: amount - fee };
}
