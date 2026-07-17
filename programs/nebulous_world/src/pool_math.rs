use crate::error::ErrorCode;
use anchor_lang::prelude::*;

/// Constant-product bonding-curve quote for `buy_neb`: how many NEB
/// `sol_in` lamports buys, given the pool's current state.
///
/// Single-sided design (see `NebPool`'s doc comment): the token side is
/// fully real (`remaining_supply`), the SOL side is `virtual_sol_reserves +
/// sol_raised` (virtual seed + real proceeds so far). `k` is fixed at pool
/// creation (`virtual_sol_reserves * total_supply`, since at creation
/// `remaining_supply == total_supply` and `sol_raised == 0`) and never
/// recomputed here, so every quote moves along the one curve implied by the
/// pool's initial parameters — this function trusts its caller to always
/// pass the SAME `total_supply`/`virtual_sol_reserves` a given pool was
/// created with.
///
/// Uses u128 throughout for the reserve/product math and only narrows to
/// u64 for the final `tokens_out`, with `checked`/`saturating` arithmetic at
/// every step — same discipline as `reward_math.rs`.
pub fn compute_buy_out(
    total_supply: u64,
    remaining_supply: u64,
    virtual_sol_reserves: u64,
    sol_raised: u64,
    sol_in: u64,
) -> Result<u64> {
    require!(sol_in > 0, ErrorCode::ZeroAmount);
    require!(remaining_supply > 0, ErrorCode::PoolSoldOut);

    let k = (virtual_sol_reserves as u128)
        .checked_mul(total_supply as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let sol_reserve_before = (virtual_sol_reserves as u128)
        .checked_add(sol_raised as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    let sol_reserve_after = sol_reserve_before
        .checked_add(sol_in as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    // sol_reserve_after > 0 always holds here (virtual_sol_reserves > 0 is
    // enforced by `init_neb_pool`, and sol_in > 0 per the require above), so
    // this division never panics.
    let token_reserve_after = k / sol_reserve_after;

    // `remaining_supply` is the real, tracked reserve; `token_reserve_after`
    // is the theoretical curve position after this buy. Saturating rather
    // than checked: if a caller ever passed a `remaining_supply` smaller
    // than where the curve says it should be (e.g. mismatched inputs), the
    // buy must be rejected as too small rather than underflowing.
    let tokens_out_128 = (remaining_supply as u128).saturating_sub(token_reserve_after);
    // tokens_out_128 is `remaining_supply - token_reserve_after` (saturated
    // at 0), so it can never exceed remaining_supply by construction —
    // u64::try_from here can never fail given `remaining_supply: u64`.
    let tokens_out = u64::try_from(tokens_out_128).map_err(|_| ErrorCode::MathOverflow)?;

    require!(tokens_out > 0, ErrorCode::BuyTooSmall);

    Ok(tokens_out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A representative pool: 1,000,000 NEB (6 decimals) total supply, 30
    // SOL virtual reserve — used across most cases below.
    const SUPPLY: u64 = 1_000_000_000_000;
    const VSOL: u64 = 30_000_000_000;

    #[test]
    fn first_buy_matches_independently_computed_curve_value() {
        let sol_in = 1_000_000_000u64; // 1 SOL
        let out = compute_buy_out(SUPPLY, SUPPLY, VSOL, 0, sol_in).unwrap();

        let k = VSOL as u128 * SUPPLY as u128;
        let expected_reserve_after = k / (VSOL as u128 + sol_in as u128);
        let expected_out = SUPPLY as u128 - expected_reserve_after;
        assert_eq!(out as u128, expected_out);
        assert!(out > 0 && out < SUPPLY);
    }

    #[test]
    fn price_increases_as_the_pool_depletes() {
        // Buying the same sol_in later (after some supply is already sold)
        // must yield strictly fewer tokens than buying it at t=0 — the
        // defining property of a bonding curve.
        let sol_in = 1_000_000_000u64; // 1 SOL
        let first = compute_buy_out(SUPPLY, SUPPLY, VSOL, 0, sol_in).unwrap();

        let remaining_after_first = SUPPLY - first;
        let second = compute_buy_out(SUPPLY, remaining_after_first, VSOL, sol_in, sol_in).unwrap();

        assert!(
            second < first,
            "second buy ({second}) should be smaller than first ({first})"
        );
    }

    #[test]
    fn remaining_supply_tracks_the_curve_exactly_across_many_buys() {
        // 20 sequential 0.5 SOL buys; after each one, the tracked
        // remaining_supply must equal the theoretical k / sol_reserve value
        // exactly (this pool never needs to reconcile rounding drift,
        // unlike e.g. reward-per-share accumulators — see the module doc
        // comment).
        let mut remaining = SUPPLY;
        let mut sol_raised = 0u64;
        let sol_in = 500_000_000u64; // 0.5 SOL
        let k = VSOL as u128 * SUPPLY as u128;

        for _ in 0..20 {
            let out = compute_buy_out(SUPPLY, remaining, VSOL, sol_raised, sol_in).unwrap();
            remaining -= out;
            sol_raised += sol_in;

            let expected = k / (VSOL as u128 + sol_raised as u128);
            assert_eq!(remaining as u128, expected);
        }
    }

    #[test]
    fn a_large_enough_buy_sells_out_the_remainder_without_reverting() {
        // A pure constant-product curve only asymptotically approaches zero
        // remaining supply — true depletion requires sol_reserve_after to
        // exceed k, which for SUPPLY/VSOL's realistic scale (chosen so
        // early prices aren't degenerate) is far beyond any u64 lamport
        // amount. Deliberately small, test-local constants here instead, so
        // k is small enough that a large-but-ordinary buy can cross that
        // threshold and this test verifies the actual "sold out cleanly, no
        // revert" behavior rather than an unreachable one.
        let tiny_supply = 100u64;
        let tiny_vsol = 10u64; // k = 1_000
        let out = compute_buy_out(tiny_supply, tiny_supply, tiny_vsol, 0, 100_000).unwrap();
        assert_eq!(out, tiny_supply);
    }

    #[test]
    fn rejects_zero_sol_in() {
        assert!(compute_buy_out(SUPPLY, SUPPLY, VSOL, 0, 0).is_err());
    }

    #[test]
    fn rejects_when_pool_already_sold_out() {
        assert!(compute_buy_out(SUPPLY, 0, VSOL, 0, 1_000_000_000).is_err());
    }

    #[test]
    fn rejects_rather_than_underflows_when_the_quote_would_be_zero_or_negative() {
        // A deliberately inconsistent (remaining_supply, reserves) pair
        // where the theoretical post-buy curve position (~5e8) exceeds the
        // passed-in remaining_supply (5) — exercises the saturating_sub
        // guard directly rather than relying on a naturally-occurring dust
        // trade to hit the same path.
        let result = compute_buy_out(1_000_000_000, 5, 1, 0, 1);
        assert!(result.is_err());
    }

    // No test exercises `k`'s checked_mul or either checked_add failing:
    // every value multiplied/added here starts as a u64 widened to u128, so
    // `u64::MAX * u64::MAX` and `u64::MAX + u64::MAX (+ u64::MAX)` all still
    // fit comfortably under `u128::MAX` — those guards are unreachable
    // defense-in-depth (matching this codebase's checked-arithmetic-
    // everywhere convention), not paths a realistic input can hit.
}
