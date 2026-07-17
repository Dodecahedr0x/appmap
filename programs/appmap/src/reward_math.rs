use crate::constants::{APP_SEED, REWARD_PRECISION, TAG_SEED};
use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

/// Reward accrued to a position since its last checkpoint, given the
/// position's staked amount, its stored reward_debt, and the pool's current
/// accumulator value. Standard "reward per share" formula.
///
/// This is a pure, pool-agnostic helper: it does not care whether `amount`/
/// `acc_reward_per_share` come from the vote pool or a tag pool, so the same
/// function backs both `vote`/`withdraw_vote`/`claim_vote_reward` and
/// `stake_tag`/`withdraw_tag_stake`/`claim_tag_reward`.
///
/// Uses explicit checked arithmetic throughout (matching how `vote.rs`
/// handles `position.amount`/`app.total_vote_stake`) rather than relying on
/// the build profile's `overflow-checks` flag, which (a) is an implicit,
/// easy-to-lose safety net for the `u128` multiply, and (b) does not protect
/// the final narrowing cast to `u64` at all — `as` casts never panic, so a
/// pending amount that legitimately exceeds `u64::MAX` would otherwise
/// silently truncate to a wrong (and exploitable) payout instead of erroring.
pub fn settle_pending(amount: u64, reward_debt: u128, acc_reward_per_share: u128) -> Result<u64> {
    let accrued = (amount as u128)
        .checked_mul(acc_reward_per_share)
        .ok_or(ErrorCode::MathOverflow)?
        / REWARD_PRECISION;
    let pending = accrued.saturating_sub(reward_debt);
    u64::try_from(pending).map_err(|_| ErrorCode::MathOverflow.into())
}

/// The reward_debt checkpoint to store after a position's amount changes,
/// so that only rewards accrued AFTER this point are claimable next time.
pub fn reward_debt_for(amount: u64, acc_reward_per_share: u128) -> Result<u128> {
    (amount as u128)
        .checked_mul(acc_reward_per_share)
        .map(|product| product / REWARD_PRECISION)
        .ok_or_else(|| ErrorCode::MathOverflow.into())
}

/// The "fund" side of the reward-per-share accumulator pattern, mirroring
/// `settle_pending`/`reward_debt_for` (the "read" side): computes the new
/// accumulator value after `amount` reward tokens are deposited across a
/// pool currently holding `total_stake` staked units.
///
/// Rejects `total_stake == 0` with `NoStakers` — funding an empty pool would
/// divide by zero, and even setting that aside, deposited tokens would be
/// stuck forever with nobody able to accrue a claim on them.
///
/// Pool-agnostic like its `settle_pending`/`reward_debt_for` counterparts:
/// `fund_app_rewards` (Task 15) uses this for both the vote pool
/// (`total_vote_stake`/`vote_acc_reward_per_share`) and the tags pool
/// (`total_tag_stake`/`tags_acc_reward_per_share`) today, and Task 18's
/// tags-specific funding path (if any) can reuse it as-is instead of
/// duplicating the formula.
pub fn bump_accumulator(amount: u64, total_stake: u64, current_acc: u128) -> Result<u128> {
    require!(total_stake > 0, ErrorCode::NoStakers);
    let delta = (amount as u128)
        .checked_mul(REWARD_PRECISION)
        .ok_or(ErrorCode::MathOverflow)?
        / total_stake as u128;
    current_acc
        .checked_add(delta)
        .ok_or_else(|| ErrorCode::MathOverflow.into())
}

/// Shared CPI-construction boilerplate behind `transfer_from_app_vault` and
/// `transfer_from_tag_vault`: both need the exact same `token::transfer` +
/// `CpiContext::new_with_signer` shape, differing only in WHICH pubkey signs
/// and WHAT seeds prove it. Keeping this one private helper means neither
/// public function can drift out of sync with the other on the CPI plumbing
/// itself (only the seeds differ, which is the one thing that must NOT be
/// shared — see the doc comments on the two public callers).
///
/// No-ops if `amount` is 0 (several callers compute a `pending` reward that
/// may legitimately be zero, and a zero-amount SPL transfer is both wasted
/// CPI cost and, for some token programs, an outright error).
fn transfer_from_pda_vault<'info>(
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority_ai: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.to_account_info(),
                authority: authority_ai.clone(),
            },
            &[signer_seeds],
        ),
        amount,
    )
}

/// Transfer `amount` out of a vault owned by the `app` PDA, with the PDA
/// signing via its ORIGINAL derivation seeds (`app_id` bytes, not
/// `app.key()` — see the critical note on `AppAccount::bump`).
///
/// Generic over which vault (vote_vault, vote_reward_vault,
/// tags_reward_vault) is being drained — callers pass whichever
/// `TokenAccount` applies, so this one helper is reusable across Tasks
/// 13-18 instead of being duplicated per instruction.
pub fn transfer_from_app_vault<'info>(
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    app_ai: &AccountInfo<'info>,
    app_id: &str,
    app_bump: u8,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let bump_seed = [app_bump];
    let seeds: &[&[u8]] = &[APP_SEED, app_id.as_bytes(), &bump_seed];
    transfer_from_pda_vault(vault, to, app_ai, seeds, token_program, amount)
}

/// Transfer `amount` out of a vault owned by the `app_tag` PDA (i.e.
/// `principal_vault`), signing with `app_tag`'s ORIGINAL derivation seeds —
/// `[TAG_SEED, app_tag.app.as_ref(), app_tag.tag_id.as_bytes(), &[bump]]`,
/// per the doc comment on `AppTagAccount::bump`. A DIFFERENT signing
/// authority than `transfer_from_app_vault` (which signs for `app`'s own
/// vaults) — do not conflate the two.
///
/// One parameter over clippy's default `too_many_arguments` threshold: the
/// `app_tag` PDA's seeds need three separate pieces (`app`, `tag_id`, its
/// own `bump`) versus `transfer_from_app_vault`'s two (`app_id`, `bump`),
/// since `AppTagAccount` is keyed by an (app, tag_id) pair rather than a
/// single id. Splitting this further would fragment the seed material this
/// function exists to assemble correctly in one place — not worth it for a
/// one-argument overage.
#[allow(clippy::too_many_arguments)]
pub fn transfer_from_tag_vault<'info>(
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    app_tag_ai: &AccountInfo<'info>,
    app: &Pubkey,
    tag_id: &str,
    app_tag_bump: u8,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let bump_seed = [app_tag_bump];
    let seeds: &[&[u8]] = &[TAG_SEED, app.as_ref(), tag_id.as_bytes(), &bump_seed];
    transfer_from_pda_vault(vault, to, app_tag_ai, seeds, token_program, amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settle_pending_zero_amount_is_zero() {
        // No stake => no accrual, regardless of the accumulator's value.
        assert_eq!(settle_pending(0, 0, 5 * REWARD_PRECISION).unwrap(), 0);
    }

    #[test]
    fn settle_pending_zero_accumulator_is_zero() {
        // Rewards never funded yet => accumulator is 0 => nothing accrued.
        assert_eq!(settle_pending(1_000, 0, 0).unwrap(), 0);
    }

    #[test]
    fn settle_pending_does_not_underflow_when_debt_exceeds_accrued() {
        // reward_debt (checkpoint at last deposit) can exceed the freshly
        // computed `accrued` value in edge cases (e.g. rounding down on a
        // tiny amount after the accumulator only grew slightly) — must
        // saturate to 0, never panic/wrap.
        let amount = 1u64;
        let acc = 1u128; // amount * acc / PRECISION rounds down to 0
        let reward_debt = 100u128; // stale, larger than the (rounded-down) accrued value
        assert_eq!(settle_pending(amount, reward_debt, acc).unwrap(), 0);
    }

    #[test]
    fn settle_pending_realistic_case() {
        // 1_000 tokens staked; accumulator has grown to represent 0.05
        // reward tokens per staked token (0.05 * REWARD_PRECISION per
        // share). Previously checkpointed at reward_debt = 10 (i.e. 10
        // raw reward units already accounted for at a prior, lower
        // accumulator value).
        let amount = 1_000u64;
        let acc_reward_per_share = REWARD_PRECISION / 20; // 0.05 * PRECISION
        let reward_debt = 10u128;

        // accrued = 1000 * (PRECISION/20) / PRECISION = 1000/20 = 50
        // pending = 50 - 10 = 40
        assert_eq!(
            settle_pending(amount, reward_debt, acc_reward_per_share).unwrap(),
            40
        );
    }

    #[test]
    fn settle_pending_rejects_multiply_overflow() {
        // amount * acc_reward_per_share overflows u128 outright — checked_mul
        // must catch this and return an error, not wrap.
        let err = settle_pending(u64::MAX, 0, u128::MAX);
        assert!(err.is_err());
    }

    #[test]
    fn settle_pending_rejects_pending_that_would_truncate_past_u64_max() {
        // amount/acc_reward_per_share combination chosen so `accrued` (and
        // therefore `pending`, since reward_debt is 0) comfortably exceeds
        // u64::MAX without overflowing the u128 multiply itself — this is
        // exactly the silent-truncation case the `as u64` cast used to miss:
        // `accrued as u64` would have wrapped to some small, WRONG payout
        // instead of erroring. u64::try_from must reject it.
        let amount = u64::MAX; // ~1.8e19
        let acc_reward_per_share = 2 * REWARD_PRECISION; // accrued = amount * 2
        let reward_debt = 0u128;
        let result = settle_pending(amount, reward_debt, acc_reward_per_share);
        assert!(
            result.is_err(),
            "expected settle_pending to reject a pending amount overflowing u64, got {:?}",
            result
        );
    }

    #[test]
    fn reward_debt_for_matches_settle_pending_accrual_formula() {
        // reward_debt_for(amount, acc) must equal the `accrued` term inside
        // settle_pending, so that checkpointing immediately after a deposit
        // yields zero pending reward for the newly-deposited amount.
        let amount = 1_000u64;
        let acc_reward_per_share = REWARD_PRECISION / 20;
        let debt = reward_debt_for(amount, acc_reward_per_share).unwrap();
        assert_eq!(debt, 50);
        assert_eq!(
            settle_pending(amount, debt, acc_reward_per_share).unwrap(),
            0
        );
    }

    #[test]
    fn reward_debt_for_zero_amount_is_zero() {
        assert_eq!(reward_debt_for(0, 5 * REWARD_PRECISION).unwrap(), 0);
    }

    #[test]
    fn reward_debt_for_rejects_multiply_overflow() {
        let err = reward_debt_for(u64::MAX, u128::MAX);
        assert!(err.is_err());
    }

    #[test]
    fn bump_accumulator_realistic_case() {
        // 1_000 tokens staked, funding 40 reward tokens => delta = 40 *
        // PRECISION / 1_000 = PRECISION / 25, added on top of a nonzero
        // starting accumulator.
        let starting_acc = 5 * REWARD_PRECISION;
        let new_acc = bump_accumulator(40, 1_000, starting_acc).unwrap();
        assert_eq!(new_acc, starting_acc + REWARD_PRECISION / 25);
    }

    #[test]
    fn bump_accumulator_rejects_zero_total_stake() {
        let err = bump_accumulator(1_000, 0, 0);
        assert!(err.is_err());
    }

    #[test]
    fn bump_accumulator_matches_settle_pending_round_trip() {
        // Funding a pool and then immediately settling a position that holds
        // the entire stake should yield exactly the funded amount back
        // (modulo integer-division rounding, avoided here by choosing evenly
        // divisible numbers) — this is the property that makes
        // `fund_app_rewards` + `claim_vote_reward` round-trip correctly.
        let total_stake = 2_000u64;
        let funded_amount = 6_000u64;
        let acc = bump_accumulator(funded_amount, total_stake, 0).unwrap();
        let pending = settle_pending(total_stake, 0, acc).unwrap();
        assert_eq!(pending, funded_amount);
    }

    #[test]
    fn bump_accumulator_rejects_multiply_overflow() {
        let err = bump_accumulator(u64::MAX, 1, u128::MAX);
        assert!(err.is_err());
    }
}
