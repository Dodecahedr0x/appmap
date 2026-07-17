use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{APP_SEED, STAKE_POSITION_SEED, TAG_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{reward_debt_for, settle_pending, transfer_from_app_vault};
use crate::state::{AppAccount, AppTagAccount, StakePosition};

/// The tags-pool mirror of `ClaimVoteReward`: pays out a staker's pending
/// tags-pool reward without touching their staked principal (which lives in
/// `app_tag.principal_vault`, never read or written here).
///
/// Takes the exact same `(app, app_tag)` account pair as `StakeTag`/
/// `WithdrawTagStake`, so it carries the exact same fund-drain risk those two
/// instructions were fixed for (see the `constraint =` below): without
/// pinning `app_tag.app == app.key()`, an attacker could pair their OWN
/// cheap `app_tag`/`position` with a victim's well-funded `app` and drain
/// the victim's real `tags_reward_vault` via `settle_pending` against the
/// victim's `tags_acc_reward_per_share`.
#[derive(Accounts)]
pub struct ClaimTagReward<'info> {
    // Not `mut`: as in `ClaimVoteReward`, this instruction only ever READS
    // `app.tags_acc_reward_per_share` (via `settle_pending`/`reward_debt_for`)
    // and `app.tags_reward_vault`'s address — `position.reward_debt` is the
    // only field that changes. Write-locking the single per-app `AppAccount`
    // PDA on every claim would needlessly serialize concurrent claims from
    // different stakers/tags against Solana's parallel-execution scheduler.
    #[account(seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    // Not `mut` either: this instruction never touches `app_tag.stake_amount`
    // (or any other field) — `app_tag.app`/`tag_id`/`bump` are only read, for
    // the ownership check below and for `position`'s seeds/PDA derivation.
    //
    // The trailing `constraint =` is required for the same reason documented
    // on `WithdrawTagStake::app_tag`: the seeds/bump constraint alone only
    // proves `app_tag` is internally self-consistent, not that it belongs to
    // the specific `app` passed alongside it in this instruction.
    #[account(
        seeds = [TAG_SEED, app_tag.app.as_ref(), app_tag.tag_id.as_bytes()],
        bump = app_tag.bump,
        constraint = app_tag.app == app.key() @ ErrorCode::TagAppMismatch,
    )]
    pub app_tag: Account<'info, AppTagAccount>,
    // As in `ClaimVoteReward`/`WithdrawTagStake`, a claim can only ever
    // target a position that already exists, so this is a plain `mut` +
    // seeds/bump constraint rather than `init_if_needed`. The single
    // `user: Signer` re-derivation of this PDA *is* the ownership check.
    #[account(
        mut,
        seeds = [STAKE_POSITION_SEED, app_tag.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,
    #[account(mut, address = app.tags_reward_vault)]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Pays the caller their pending tags-pool reward without touching their
/// staked principal (`position.amount` is read but never reassigned below).
///
/// A zero-`pending` claim is allowed to go through as a harmless no-op
/// rather than being rejected with a `require!`, matching
/// `claim_vote_reward()`'s established precedent — see that handler's doc
/// comment for the full rationale.
pub fn handler(ctx: Context<ClaimTagReward>) -> Result<()> {
    let pending = settle_pending(
        ctx.accounts.position.amount,
        ctx.accounts.position.reward_debt,
        ctx.accounts.app.tags_acc_reward_per_share,
    )?;

    let app_ai = ctx.accounts.app.to_account_info();
    let app_id = ctx.accounts.app.app_id.clone();
    let app_bump = ctx.accounts.app.bump;

    transfer_from_app_vault(
        &ctx.accounts.tags_reward_vault,
        &ctx.accounts.user_token_account,
        &app_ai,
        &app_id,
        app_bump,
        &ctx.accounts.token_program,
        pending,
    )?;

    let app = &ctx.accounts.app;
    let position = &mut ctx.accounts.position;
    position.reward_debt = reward_debt_for(position.amount, app.tags_acc_reward_per_share)?;

    Ok(())
}
