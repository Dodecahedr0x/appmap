use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{APP_SEED, APP_TAG_STAKE_SEED, CONFIG_SEED, STAKE_POSITION_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{reward_debt_for, settle_pending, transfer_from_vault};
use crate::state::{AppAccount, AppTagStake, Config, StakePosition};

/// The tag-staking mirror of `WithdrawVote`. Unlike the pre-global-vault
/// design, there is only ONE signing authority involved here (`config`, for
/// both the reward payout and the principal return) — no more juggling two
/// different PDA signers for two different vaults.
#[derive(Accounts)]
pub struct WithdrawTagStake<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    // See `StakeTag::app_tag_stake`'s doc comment for why the trailing
    // `constraint =` is required: the seeds/bump constraint alone only
    // proves `app_tag_stake` is internally self-consistent, not that it
    // belongs to the specific `app` passed alongside it in this instruction.
    #[account(
        mut,
        seeds = [APP_TAG_STAKE_SEED, app_tag_stake.app.as_ref(), app_tag_stake.tag.as_ref()],
        bump = app_tag_stake.bump,
        constraint = app_tag_stake.app == app.key() @ ErrorCode::AppTagStakeMismatch,
    )]
    pub app_tag_stake: Account<'info, AppTagStake>,
    // As in `WithdrawVote`, a withdrawal can only ever target a position
    // that already exists, so this is a plain `mut` + seeds/bump constraint
    // rather than `init_if_needed`. The single `user: Signer` re-derivation
    // of this PDA *is* the ownership check.
    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, app_tag_stake.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        address = get_associated_token_address(&config.key(), &config.vote_mint),
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Moves `amount` of previously-locked tag-stake principal back out of the
/// global vault to the caller, always settling (and paying out) any pending
/// tags-pool reward accrued on the position first — mirrors
/// `withdraw_vote()`'s checkpoint-before-size-change requirement,
/// unconditional here for the same reason documented there (an existing
/// position always has `amount > 0`).
pub fn handler(ctx: Context<WithdrawTagStake>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(
        ctx.accounts.position.amount >= amount,
        ErrorCode::InsufficientStake
    );

    let pending = settle_pending(
        ctx.accounts.position.amount,
        ctx.accounts.position.reward_debt,
        ctx.accounts.app.tags_acc_reward_per_share,
    )?;
    transfer_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.user_token_account,
        &ctx.accounts.config.to_account_info(),
        ctx.accounts.config.bump,
        &ctx.accounts.token_program,
        pending,
    )?;

    let app = &mut ctx.accounts.app;
    let app_tag_stake = &mut ctx.accounts.app_tag_stake;
    let position = &mut ctx.accounts.position;

    position.amount -= amount; // safe: checked `position.amount >= amount` above
    app_tag_stake.stake_amount = app_tag_stake
        .stake_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    app.total_tag_stake = app
        .total_tag_stake
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.reward_debt = reward_debt_for(position.amount, app.tags_acc_reward_per_share)?;

    // Return principal, signed by `config`.
    transfer_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.user_token_account,
        &ctx.accounts.config.to_account_info(),
        ctx.accounts.config.bump,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}
