use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{APP_SEED, STAKE_POSITION_SEED, TAG_SEED};
use crate::error::ErrorCode;
use crate::reward_math::{reward_debt_for, settle_pending, transfer_from_app_vault};
use crate::state::{AppAccount, AppTagAccount, StakePosition};

/// The tag-staking mirror of `Vote`, with one wrinkle: TWO PDAs are read
/// here (`app` and `app_tag`), though only ONE of them (`app`) ever signs a
/// CPI in this instruction — the pending-reward payout out of the SHARED
/// `tags_reward_vault`. The principal-in leg below needs no PDA signer at
/// all (same as `Vote`'s), and `app_tag` itself never signs here (it only
/// signs in `withdraw_tag_stake`, when principal moves back OUT of its
/// `principal_vault`).
#[derive(Accounts)]
pub struct StakeTag<'info> {
    #[account(mut, seeds = [APP_SEED, app.app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    // No instruction-arg `tag_id` needed to derive/validate this PDA: once
    // `app_tag` is deserialized (a plain `mut`, not `init`, since a stake can
    // only ever target an already-suggested tag), its seeds constraint can
    // reference its OWN already-deserialized fields
    // (`app_tag.app`/`app_tag.tag_id`) — the same self-referential pattern
    // `WithdrawVote`/`ClaimVoteReward` use for `app.app_id`.
    //
    // The seeds/bump constraint alone only proves `app_tag` is internally
    // self-consistent — it does NOT prove `app_tag` belongs to the `app`
    // account passed alongside it in this same instruction. Without the
    // `constraint =` below, an attacker could permissionlessly create their
    // OWN `app`/`app_tag` pair and then call `stake_tag` with THEIR
    // `app_tag` but a victim's well-funded `app`: `principal_vault` would
    // still address-check against the attacker's own vault (safe), but
    // `tags_reward_vault` would address-check against the VICTIM's real
    // vault, and the handler would credit the attacker's position against
    // the victim's `total_tag_stake`/`tags_acc_reward_per_share` —
    // ultimately letting the attacker drain the victim's real reward vault
    // and dilute real stakers via the corrupted stake denominator. This
    // explicit cross-check closes that gap, mirroring the `has_one =
    // authority @ ErrorCode::Unauthorized` idiom in `fund_app_rewards.rs`
    // (a plain `constraint =` here since it's not a same-named-field match).
    #[account(
        mut,
        seeds = [TAG_SEED, app_tag.app.as_ref(), app_tag.tag_id.as_bytes()],
        bump = app_tag.bump,
        constraint = app_tag.app == app.key() @ ErrorCode::TagAppMismatch,
    )]
    pub app_tag: Account<'info, AppTagAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StakePosition::SPACE,
        seeds = [STAKE_POSITION_SEED, app_tag.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, StakePosition>,
    #[account(mut, address = app_tag.principal_vault)]
    pub principal_vault: Account<'info, TokenAccount>,
    #[account(mut, address = app.tags_reward_vault)]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Locks `amount` of the vote token into `app_tag.principal_vault`,
/// auto-settling any pending tags-pool reward accrued on the caller's
/// existing position first — same checkpoint-before-size-change requirement
/// as `vote()`. The key difference from `vote()`: the accumulator checked
/// against and the vault paid out of are `app.tags_acc_reward_per_share` /
/// `app.tags_reward_vault` (shared across ALL of this app's tags), NOT
/// anything stored per-tag on `app_tag` — see the design note on
/// `AppTagAccount`.
///
/// `app_tag.stake_amount` and `app.total_tag_stake` are two independent
/// counters that must move in lockstep on every mutation: the former is this
/// tag's own principal total, the latter is the shared pool's total (the
/// denominator `fund_app_rewards`'s Tags-pool `bump_accumulator` divides by).
/// Letting them drift would either starve or over-pay every tag's stakers.
pub fn handler(ctx: Context<StakeTag>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let position = &mut ctx.accounts.position;

    if position.amount > 0 {
        let pending = settle_pending(
            position.amount,
            position.reward_debt,
            ctx.accounts.app.tags_acc_reward_per_share,
        )?;
        // Capture the app's signer material into locals *before* taking a
        // fresh `&mut` borrow of `ctx.accounts.app` further down for
        // `total_tag_stake` — same borrow-checker-safe pattern as `vote()`.
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
    }

    // Transfer principal IN, signed by the user (not either PDA) — this leg
    // needs no PDA signer seeds at all.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.principal_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let app = &mut ctx.accounts.app;
    let app_tag = &mut ctx.accounts.app_tag;
    let position = &mut ctx.accounts.position;

    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.owner = ctx.accounts.user.key();
    position.bump = ctx.bumps.position;
    app_tag.stake_amount = app_tag
        .stake_amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    app.total_tag_stake = app
        .total_tag_stake
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    position.reward_debt = reward_debt_for(position.amount, app.tags_acc_reward_per_share)?;

    Ok(())
}
