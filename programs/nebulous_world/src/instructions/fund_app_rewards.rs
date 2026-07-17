use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{APP_SEED, CONFIG_SEED};
use crate::error::ErrorCode;
use crate::reward_math::bump_accumulator;
use crate::state::{AppAccount, Config, RewardPool};

/// Authority-gated: only `Config.authority` (set once during `initialize`,
/// meant for exactly this kind of ongoing admin operation) may fund a pool.
/// This is a routine, repeatable admin action — unlike `initialize`'s
/// one-time bootstrap, which needs the heavier upgrade-authority/`ProgramData`
/// dance to close a front-running window before `Config.authority` even
/// exists. Here `Config.authority` already exists, so the standard,
/// idiomatic `has_one` check against a `Signer` is the correct, simplest
/// fit.
///
/// Both reward vaults are always passed as accounts (regardless of which
/// pool `pool` selects) since Anchor resolves every account up front; the
/// handler picks which one to actually mutate based on the instruction arg.
#[derive(Accounts)]
pub struct FundAppRewards<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, address = app.vote_reward_vault)]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.tags_reward_vault)]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub funder_token_account: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Deposits `amount` real reward tokens into whichever pool `pool` selects,
/// bumping that pool's accumulator so existing stakers can subsequently
/// claim their proportional share via `claim_vote_reward`/`withdraw_vote`
/// (vote pool) or the Task 16-18 tag equivalents (tags pool).
///
/// All the total-stake/current-accumulator reads happen up front (before any
/// CPI or mutation), so no `&mut` borrow of `ctx.accounts.app` needs to
/// survive across the `token::transfer` CPI below — unlike `vote()`/
/// `withdraw_vote()`, this instruction has no PDA signer material to capture
/// either, since `authority` (a separate, ordinary signer) authorizes the
/// incoming transfer, not the `app` PDA. `app` only gets a single `&mut`
/// borrow at the very end, purely to write the new accumulator value back.
pub fn handler(ctx: Context<FundAppRewards>, pool: RewardPool, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let (total_stake, current_acc, target_vault_ai) = match pool {
        RewardPool::Vote => (
            ctx.accounts.app.total_vote_stake,
            ctx.accounts.app.vote_acc_reward_per_share,
            ctx.accounts.vote_reward_vault.to_account_info(),
        ),
        RewardPool::Tags => (
            ctx.accounts.app.total_tag_stake,
            ctx.accounts.app.tags_acc_reward_per_share,
            ctx.accounts.tags_reward_vault.to_account_info(),
        ),
    };

    // `bump_accumulator` rejects `total_stake == 0` with `NoStakers` before
    // any tokens move, so an empty pool can never have funds locked into it
    // with no one able to claim them.
    let new_acc = bump_accumulator(amount, total_stake, current_acc)?;

    // Transfer funder -> target vault, signed by `authority` (the funder),
    // NOT the app PDA — this is money coming IN from the platform, not a
    // payout, so it needs no PDA signer seeds at all (same "no seeds
    // needed" shape as vote()'s principal-in leg).
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.funder_token_account.to_account_info(),
                to: target_vault_ai,
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
    )?;

    let app = &mut ctx.accounts.app;
    match pool {
        RewardPool::Vote => app.vote_acc_reward_per_share = new_acc,
        RewardPool::Tags => app.tags_acc_reward_per_share = new_acc,
    }

    Ok(())
}
