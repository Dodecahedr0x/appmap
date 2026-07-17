import { BN } from "@anchor-lang/core";

// Pure-function mirror of `reward_math::settle_pending` in the Anchor
// program (programs/nebulous_world/src/reward_math.rs) — the standard
// "reward per share" accumulator formula. Kept in lockstep with the Rust
// version by hand, same convention as lib/pool.ts mirroring pool_math.rs.

/** Must match `REWARD_PRECISION` in programs/nebulous_world/src/constants.rs. */
export const REWARD_PRECISION = new BN("1000000000000");

/**
 * Reward accrued to a position since its last checkpoint, given the
 * position's staked `amount`, its stored `rewardDebt`, and the pool's
 * current `accRewardPerShare` — all raw on-chain u64/u128 values. Returns a
 * raw u64 BN (never negative — saturates to zero, mirroring the Rust
 * `saturating_sub`).
 */
export function settlePendingRaw(amount: BN, rewardDebt: BN, accRewardPerShare: BN): BN {
  const accrued = amount.mul(accRewardPerShare).div(REWARD_PRECISION);
  const pending = accrued.sub(rewardDebt);
  return pending.isNeg() ? new BN(0) : pending;
}
