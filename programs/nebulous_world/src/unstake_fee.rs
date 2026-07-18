use crate::constants::{UNSTAKE_FEE_DECAY_SECONDS, UNSTAKE_FEE_START_BPS};
use crate::error::ErrorCode;
use anchor_lang::prelude::*;

/// Every `withdraw_vote`/`withdraw_tag_stake` pays a fee that starts at
/// `UNSTAKE_FEE_START_BPS` (1%) the instant a position is opened and decays
/// linearly to 0 over `UNSTAKE_FEE_DECAY_SECONDS` (one week) — a short-term
/// exit tax, not a permanent lockup: `amount` can always be withdrawn, just
/// at a shrinking discount. Fee bps at `elapsed_secs` since the position's
/// `staked_at` checkpoint:
///
/// ```text
/// fee_bps(0)                       = UNSTAKE_FEE_START_BPS
/// fee_bps(UNSTAKE_FEE_DECAY_SECONDS) = 0
/// fee_bps(t) linear in between
/// ```
///
/// `elapsed_secs` can be negative in principle (a position's weighted-average
/// `staked_at` — see `weighted_avg_timestamp` — is always `<= now` by
/// construction, but Solana's `Clock::unix_timestamp` is not itself
/// monotonic-guaranteed across a cluster restart) — clamp to the start-of-decay
/// fee rather than let a negative elapsed time produce a nonsensical bps.
pub fn linear_decay_fee_bps(elapsed_secs: i64) -> u16 {
    if elapsed_secs <= 0 {
        return UNSTAKE_FEE_START_BPS;
    }
    if elapsed_secs >= UNSTAKE_FEE_DECAY_SECONDS {
        return 0;
    }
    // Integer math only: (start_bps * remaining_secs) / decay_secs, computed
    // in i64 (both operands comfortably fit — start_bps <= 10_000, elapsed/
    // decay are a handful of days in seconds — nowhere near i64::MAX) then
    // narrowed back to u16, which cannot fail since the result is bounded by
    // UNSTAKE_FEE_START_BPS on both ends of the clamp above.
    let remaining_secs = UNSTAKE_FEE_DECAY_SECONDS - elapsed_secs;
    ((UNSTAKE_FEE_START_BPS as i64 * remaining_secs) / UNSTAKE_FEE_DECAY_SECONDS) as u16
}

/// The fee portion of an `amount` being unstaked, at `fee_bps`. Same
/// checked-`u128`-then-narrow pattern as `reward_math.rs`'s `settle_pending`
/// — `fee_bps <= UNSTAKE_FEE_START_BPS` (100) in practice, so this can never
/// legitimately overflow `u64`, but `u64::try_from` still guards against a
/// silent wraparound rather than trusting the caller's invariant blindly.
///
/// Rounds the fee UP (`div_ceil`), not down: `settle_pending`/
/// `bump_accumulator` in `reward_math.rs` both round in the protocol's favor
/// (a staker never accrues more than what was actually funded) — this
/// matches that direction rather than rounding the withdrawer's fee down,
/// which would let every withdrawal shave off up to one raw unit at the
/// protocol's expense instead of the withdrawer's.
pub fn unstake_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .div_ceil(10_000);
    u64::try_from(fee).map_err(|_| ErrorCode::MathOverflow.into())
}

/// The `staked_at` checkpoint to store after `added_amount` is deposited on
/// top of a position that already held `old_amount` (checkpointed at
/// `old_staked_at`): a size-weighted average of the two timestamps, so a
/// top-up only partially resets the position's fee-decay clock in proportion
/// to how much of the new total it represents — topping up a large,
/// long-held position with a small amount barely moves the checkpoint,
/// while topping up a small position with a much larger amount pulls the
/// checkpoint close to `now`. This is what closes the gap a simpler
/// "checkpoint only the first deposit, never touch it again" design would
/// leave open: with a fixed first-deposit checkpoint, staking a token once,
/// waiting out the decay window, then depositing an arbitrarily large amount
/// would let that entire top-up withdraw fee-free immediately, defeating the
/// fee's purpose entirely.
///
/// `old_amount`/`added_amount` are `u64` (token amounts, up to ~1.8e19) and
/// the timestamps are ordinary Unix seconds (~1.8e9 today) — their product is
/// at most ~3.3e28, four orders of magnitude below `i128::MAX` (~1.7e38), so
/// plain (non-checked) `i128` arithmetic here can't realistically overflow;
/// checked arithmetic would only add ceremony without closing any real gap.
pub fn weighted_avg_timestamp(
    old_staked_at: i64,
    old_amount: u64,
    now: i64,
    added_amount: u64,
) -> i64 {
    let total = old_amount as u128 + added_amount as u128;
    if total == 0 {
        return now;
    }
    let weighted = (old_staked_at as i128 * old_amount as i128
        + now as i128 * added_amount as i128)
        / total as i128;
    // Always lies between `old_staked_at` and `now` (a weighted average of
    // the two), both valid `i64` timestamps — cannot overflow `i64` on the
    // narrowing cast back.
    weighted as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_decay_fee_bps_at_zero_elapsed_is_the_start_fee() {
        assert_eq!(linear_decay_fee_bps(0), UNSTAKE_FEE_START_BPS);
    }

    #[test]
    fn linear_decay_fee_bps_clamps_negative_elapsed_to_the_start_fee() {
        assert_eq!(linear_decay_fee_bps(-1), UNSTAKE_FEE_START_BPS);
        assert_eq!(linear_decay_fee_bps(-1_000_000), UNSTAKE_FEE_START_BPS);
    }

    #[test]
    fn linear_decay_fee_bps_is_zero_at_exactly_the_decay_window() {
        assert_eq!(linear_decay_fee_bps(UNSTAKE_FEE_DECAY_SECONDS), 0);
    }

    #[test]
    fn linear_decay_fee_bps_is_zero_past_the_decay_window() {
        assert_eq!(linear_decay_fee_bps(UNSTAKE_FEE_DECAY_SECONDS + 1), 0);
        assert_eq!(linear_decay_fee_bps(UNSTAKE_FEE_DECAY_SECONDS * 100), 0);
    }

    #[test]
    fn linear_decay_fee_bps_is_exactly_half_at_the_midpoint() {
        assert_eq!(
            linear_decay_fee_bps(UNSTAKE_FEE_DECAY_SECONDS / 2),
            UNSTAKE_FEE_START_BPS / 2
        );
    }

    #[test]
    fn linear_decay_fee_bps_is_monotonically_non_increasing() {
        let mut prev = linear_decay_fee_bps(0);
        let mut t = 0;
        while t <= UNSTAKE_FEE_DECAY_SECONDS {
            let cur = linear_decay_fee_bps(t);
            assert!(cur <= prev, "fee_bps must never increase as time passes");
            prev = cur;
            t += UNSTAKE_FEE_DECAY_SECONDS / 100;
        }
    }

    #[test]
    fn unstake_fee_at_start_bps_is_one_percent() {
        // 1_000_000 raw units at 100 bps (1%) = 10_000.
        assert_eq!(unstake_fee(1_000_000, 100).unwrap(), 10_000);
    }

    #[test]
    fn unstake_fee_at_zero_bps_is_zero() {
        assert_eq!(unstake_fee(1_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn unstake_fee_rounds_up() {
        // 999 * 100 / 10_000 = 9.99 -> ceils to 10, in the protocol's favor
        // (never the withdrawer's) — the withdrawer's net payout rounds
        // down by the same fraction of a raw unit instead.
        assert_eq!(unstake_fee(999, 100).unwrap(), 10);
    }

    #[test]
    fn unstake_fee_is_exact_when_evenly_divisible() {
        // No rounding at all needed here — div_ceil must not add a spurious
        // extra unit when the division is already exact.
        assert_eq!(unstake_fee(1_000_000, 100).unwrap(), 10_000);
    }

    #[test]
    fn unstake_fee_of_zero_amount_is_zero() {
        assert_eq!(unstake_fee(0, 100).unwrap(), 0);
    }

    #[test]
    fn unstake_fee_rejects_multiply_overflow() {
        let err = unstake_fee(u64::MAX, u16::MAX);
        assert!(err.is_err());
    }

    #[test]
    fn weighted_avg_timestamp_on_a_fresh_position_is_just_now() {
        // old_amount == 0 (a brand-new position) => the average collapses to
        // `now`, exactly like a fresh checkpoint would.
        assert_eq!(weighted_avg_timestamp(0, 0, 1_000, 500), 1_000);
    }

    #[test]
    fn weighted_avg_timestamp_with_equal_amounts_is_the_midpoint() {
        assert_eq!(weighted_avg_timestamp(0, 100, 1_000, 100), 500);
    }

    #[test]
    fn weighted_avg_timestamp_a_small_top_up_barely_moves_a_large_old_position() {
        // 1_000_000 held since t=0, topped up with a mere 1 unit at t=1_000.
        // The checkpoint should stay extremely close to 0, not jump toward
        // 1_000 — a small top-up must not meaningfully reset a large
        // position's fee-decay clock.
        let result = weighted_avg_timestamp(0, 1_000_000, 1_000, 1);
        assert_eq!(result, 0); // rounds down to exactly 0 at this ratio
    }

    #[test]
    fn weighted_avg_timestamp_a_large_top_up_pulls_a_small_old_position_close_to_now() {
        // Mirror case: 1 unit held since t=0, topped up with 1_000_000 at
        // t=1_000 — the checkpoint should land almost exactly at 1_000, not
        // stay near the old, now-irrelevant checkpoint.
        let result = weighted_avg_timestamp(0, 1, 1_000, 1_000_000);
        assert_eq!(result, 999); // rounds down from 999.999...
    }

    #[test]
    fn weighted_avg_timestamp_is_a_true_average_regression_case() {
        // Same shape as reward_math.rs's realistic-case tests: a concrete,
        // hand-computed example rather than only algebraic identities.
        // old: 300 units since t=100; add: 700 units at t=200.
        // weighted = (100*300 + 200*700) / 1000 = (30_000 + 140_000)/1000 = 170.
        assert_eq!(weighted_avg_timestamp(100, 300, 200, 700), 170);
    }
}
