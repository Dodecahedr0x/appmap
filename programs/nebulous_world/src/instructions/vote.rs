use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{APP_SEED, VOTE_POSITION_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{reward_debt_for, settle_pending, transfer_from_app_vault};
use crate::state::{AppAccount, VotePosition};

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + VotePosition::SPACE,
        seeds = [VOTE_POSITION_SEED, app.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, VotePosition>,
    #[account(mut, address = app.vote_vault)]
    pub vote_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.vote_reward_vault)]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Locks `amount` of the vote token into `app.vote_vault`, auto-settling any
/// pending vote-reward accrued on the caller's existing position (if any)
/// before the position's size changes — the standard accumulator-pattern
/// requirement: rewards must be checkpointed *before* `amount` moves, or the
/// old stake would retroactively "earn" rewards accrued only after the top-up.
///
/// On the very first vote for a fresh `VotePosition`, `position.amount` is
/// 0 (zero-initialized by `init_if_needed`), so the settle-and-pay-out step
/// below is skipped entirely — there is nothing to settle yet, and
/// `fund_app_rewards` (Task 15) doesn't exist yet to have funded
/// `vote_reward_vault` in the first place.
pub fn handler(ctx: Context<Vote>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let position = &mut ctx.accounts.position;

    if position.amount > 0 {
        let pending = settle_pending(
            position.amount,
            position.reward_debt,
            ctx.accounts.app.vote_acc_reward_per_share,
        )?;
        // Capture the app's signer material into locals *before* taking a
        // fresh `&mut` borrow of `ctx.accounts.app` further down for
        // `total_vote_stake` — `app_ai`/`app_id`/`app_bump` are independent
        // owned/Copy values, so this satisfies the borrow checker without
        // holding any borrow of `ctx.accounts.app` open across the CPI call
        // and the later mutation.
        let app_ai = ctx.accounts.app.to_account_info();
        let app_id = ctx.accounts.app.app_id.clone();
        let app_bump = ctx.accounts.app.bump;
        transfer_from_app_vault(
            &ctx.accounts.vote_reward_vault,
            &ctx.accounts.user_token_account,
            &app_ai,
            &app_id,
            app_bump,
            &ctx.accounts.token_program,
            pending,
        )?;
    }

    // Transfer principal IN, signed by the user (not the app PDA) — this
    // leg needs no PDA signer seeds at all.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vote_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let app = &mut ctx.accounts.app;
    let position = &mut ctx.accounts.position;

    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.owner = ctx.accounts.user.key();
    position.bump = ctx.bumps.position;
    app.total_vote_stake = app
        .total_vote_stake
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.reward_debt = reward_debt_for(position.amount, app.vote_acc_reward_per_share)?;

    Ok(())
}
