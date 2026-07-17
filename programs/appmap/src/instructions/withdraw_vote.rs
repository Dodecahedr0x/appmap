use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{APP_SEED, VOTE_POSITION_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{reward_debt_for, settle_pending, transfer_from_app_vault};
use crate::state::{AppAccount, VotePosition};

#[derive(Accounts)]
pub struct WithdrawVote<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    // Unlike `Vote`'s `position` (which is `init_if_needed` — a vote may be
    // the very first one for this user/app pair), a withdrawal can only ever
    // target a position that already exists: you cannot withdraw stake from
    // a position you never opened. Hence a plain `mut` + seeds/bump
    // constraint here instead of `init_if_needed`.
    //
    // Only a single `user: Signer` is used to authorize the withdrawal —
    // deliberately mirroring `Vote`'s single-`user` design rather than
    // splitting into separate `owner`/`user` accounts. The `position` PDA is
    // derived from `user.key()` (seeds below), exactly as it was when
    // `vote()` first created it, so requiring this specific signer's
    // signature to re-derive that same PDA *is* the ownership check: no
    // other signer's key can ever produce the seeds that validate against
    // this particular `position` address. A separate `has_one = owner`
    // field would be redundant — `VotePosition::owner` is stored for
    // convenience/introspection (as documented on the struct), not because
    // seeds-based derivation needs it as a second authorization gate.
    #[account(
        mut,
        seeds = [VOTE_POSITION_SEED, app.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, VotePosition>,
    #[account(mut, address = app.vote_vault)]
    pub vote_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.vote_reward_vault)]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Moves `amount` of previously-locked vote-stake principal back out of
/// `app.vote_vault` to the caller, always settling (and paying out) any
/// pending vote-reward accrued on the position first — mirrors `vote()`'s
/// checkpoint-before-size-change requirement, except here settlement is
/// unconditional rather than guarded by `position.amount > 0`: a
/// `WithdrawVote` can only ever run against an existing position, and an
/// existing position always has `amount > 0` (it's either the first stake,
/// which set `amount > 0`, or a prior partial withdrawal that left some
/// stake behind per the `amount >= amount` check below) — there is no
/// "freshly zero-initialized" case to guard against here the way `vote()`
/// has to for a brand-new `init_if_needed` position.
pub fn handler(ctx: Context<WithdrawVote>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(
        ctx.accounts.position.amount >= amount,
        ErrorCode::InsufficientStake
    );

    // Capture the app PDA's signer material into locals *once*, before any
    // mutation below — both CPIs in this handler (the pending-reward payout
    // and the principal return) are signed by the app PDA, and `app_id`/
    // `app_bump` never change, so a single capture up front covers both
    // calls. This sidesteps the borrow-checker problem of needing a second
    // `ctx.accounts.app.to_account_info()` after `ctx.accounts.app` has been
    // taken as `&mut` in between: `app_ai` is a clone of the `AccountInfo`
    // handle (valid for the whole `'info` lifetime and independent of the
    // deserialized `AppAccount` struct's field values, which only matter for
    // the *subsequent* `total_vote_stake` bookkeeping, not for CPI signing),
    // and `app_id`/`app_bump` are owned/Copy values.
    let app_ai = ctx.accounts.app.to_account_info();
    let app_id = ctx.accounts.app.app_id.clone();
    let app_bump = ctx.accounts.app.bump;

    let pending = settle_pending(
        ctx.accounts.position.amount,
        ctx.accounts.position.reward_debt,
        ctx.accounts.app.vote_acc_reward_per_share,
    )?;
    transfer_from_app_vault(
        &ctx.accounts.vote_reward_vault,
        &ctx.accounts.user_token_account,
        &app_ai,
        &app_id,
        app_bump,
        &ctx.accounts.token_program,
        pending,
    )?;

    let app = &mut ctx.accounts.app;
    let position = &mut ctx.accounts.position;

    position.amount -= amount; // safe: checked `position.amount >= amount` above
    app.total_vote_stake = app
        .total_vote_stake
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.reward_debt = reward_debt_for(position.amount, app.vote_acc_reward_per_share)?;

    // Return principal, signed by the app PDA — using the same locals
    // captured above, before either mutation just performed.
    transfer_from_app_vault(
        &ctx.accounts.vote_vault,
        &ctx.accounts.user_token_account,
        &app_ai,
        &app_id,
        app_bump,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}
