use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{APP_SEED, STAKE_POSITION_SEED, TAG_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{
    reward_debt_for, settle_pending, transfer_from_app_vault, transfer_from_tag_vault,
};
use crate::state::{AppAccount, AppTagAccount, StakePosition};

/// The tag-staking mirror of `WithdrawVote`, with the genuinely new
/// complexity this task is about: TWO DIFFERENT PDA signing authorities are
/// involved in one instruction. `app` signs for the pending-reward payout
/// out of the SHARED `tags_reward_vault`; `app_tag` signs for the returned
/// principal out of ITS OWN `principal_vault`. See the handler doc comment
/// for how the two seed sets are kept straight.
#[derive(Accounts)]
pub struct WithdrawTagStake<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    // See `StakeTag::app_tag`'s doc comment for why the trailing
    // `constraint =` is required: the seeds/bump constraint alone only
    // proves `app_tag` is internally self-consistent, not that it belongs
    // to the specific `app` passed alongside it in this instruction. Without
    // it, an attacker could pair their OWN `app_tag` with a victim's
    // well-funded `app` and drain the victim's real `tags_reward_vault`
    // while their own principal sits safely in their own vault the whole
    // time.
    #[account(
        mut,
        seeds = [TAG_SEED, app_tag.app.as_ref(), app_tag.tag_id.as_bytes()],
        bump = app_tag.bump,
        constraint = app_tag.app == app.key() @ ErrorCode::TagAppMismatch,
    )]
    pub app_tag: Account<'info, AppTagAccount>,
    // As in `WithdrawVote`, a withdrawal can only ever target a position
    // that already exists, so this is a plain `mut` + seeds/bump constraint
    // rather than `init_if_needed`. The single `user: Signer` re-derivation
    // of this PDA *is* the ownership check, exactly as documented on
    // `WithdrawVote`.
    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, app_tag.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,
    #[account(mut, address = app_tag.principal_vault)]
    pub principal_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.tags_reward_vault)]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Moves `amount` of previously-locked tag-stake principal back out of
/// `app_tag.principal_vault` to the caller, always settling (and paying out)
/// any pending tags-pool reward accrued on the position first — mirrors
/// `withdraw_vote()`'s checkpoint-before-size-change requirement,
/// unconditional here for the same reason documented there (an existing
/// position always has `amount > 0`).
///
/// The two-authority wrinkle: BOTH sets of signer material (`app`'s
/// `app_id`/`bump` AND `app_tag`'s `app`/`tag_id`/`bump`) are captured into
/// locals up front, before any mutation — following the same
/// borrow-checker-safe capture pattern `withdraw_vote()` established, just
/// doubled since two distinct PDAs sign two distinct CPIs here instead of
/// one PDA signing both. Do not conflate the two: `app` signs ONLY for
/// `tags_reward_vault` (shared across all tags), `app_tag` signs ONLY for
/// `principal_vault` (this tag's own).
pub fn handler(ctx: Context<WithdrawTagStake>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(
        ctx.accounts.position.amount >= amount,
        ErrorCode::InsufficientStake
    );

    // Signer material for the `app` PDA — signs the pending-reward payout
    // out of the shared `tags_reward_vault`.
    let app_ai = ctx.accounts.app.to_account_info();
    let app_id = ctx.accounts.app.app_id.clone();
    let app_bump = ctx.accounts.app.bump;

    // Signer material for the `app_tag` PDA — signs the principal return out
    // of this tag's own `principal_vault`. A DIFFERENT signing authority
    // from `app`'s, per the doc comment on `AppTagAccount::bump`.
    let app_tag_ai = ctx.accounts.app_tag.to_account_info();
    let app_tag_app = ctx.accounts.app_tag.app;
    let app_tag_tag_id = ctx.accounts.app_tag.tag_id.clone();
    let app_tag_bump = ctx.accounts.app_tag.bump;

    let pending = settle_pending(
        ctx.accounts.position.amount,
        ctx.accounts.position.reward_debt,
        ctx.accounts.app.tags_acc_reward_per_share,
    )?;
    // Pay pending reward, signed by `app`.
    transfer_from_app_vault(
        &ctx.accounts.tags_reward_vault,
        &ctx.accounts.user_token_account,
        &app_ai,
        &app_id,
        app_bump,
        &ctx.accounts.token_program,
        pending,
    )?;

    let app = &mut ctx.accounts.app;
    let app_tag = &mut ctx.accounts.app_tag;
    let position = &mut ctx.accounts.position;

    position.amount -= amount; // safe: checked `position.amount >= amount` above
    app_tag.stake_amount = app_tag
        .stake_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    app.total_tag_stake = app
        .total_tag_stake
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.reward_debt = reward_debt_for(position.amount, app.tags_acc_reward_per_share)?;

    // Return principal, signed by `app_tag` — using the seeds captured
    // above, before any of the three mutations just performed.
    transfer_from_tag_vault(
        &ctx.accounts.principal_vault,
        &ctx.accounts.user_token_account,
        &app_tag_ai,
        &app_tag_app,
        &app_tag_tag_id,
        app_tag_bump,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}
