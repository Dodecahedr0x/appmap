use anchor_lang::prelude::*;

use crate::constants::{APP_SEED, MAX_APP_ID_LEN};
use crate::error::ErrorCode;
use crate::state::AppAccount;

/// `init_app` is intentionally PERMISSIONLESS: apps are crowd-submitted, so
/// anyone may register any `app_id` by paying for the account creation.
/// Unlike `initialize` (which protects the one global `Config` singleton),
/// there is no authority/signer-identity check here, and there must never
/// be one — gating this would contradict the crowd-submission product
/// design.
///
/// Creates only the `AppAccount` accounting record — no vaults. Every app
/// shares the single global vault documented on `Config`, so registering a
/// new app costs no token-account rent at all.
#[derive(Accounts)]
#[instruction(app_id: String)]
pub struct InitApp<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + AppAccount::SPACE,
        seeds = [APP_SEED, app_id.as_bytes()],
        bump,
    )]
    pub app: Account<'info, AppAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitApp>, app_id: String) -> Result<()> {
    // NOTE on ordering: this check cannot actually prevent the failure mode
    // it names. Anchor's generated `try_accounts` resolves every `init`
    // field (including `app`'s PDA derivation via
    // `Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], ..)`)
    // *before* the handler body ever runs, and `find_program_address` panics
    // if a seed exceeds Solana's 32-byte-per-seed limit, so an oversized
    // `app_id` aborts the transaction during account validation, surfacing
    // as an opaque runtime failure rather than `AppIdTooLong`. This
    // `require!` is kept as documentation of the invariant and a backstop
    // against future refactors — not worth hand-rolling `app`'s account
    // creation instead of using `init` for an edge case Prisma cuids (~25
    // bytes) don't hit in practice.
    require!(
        app_id.len() <= MAX_APP_ID_LEN as usize,
        ErrorCode::AppIdTooLong
    );

    let app = &mut ctx.accounts.app;
    app.app_id = app_id;
    app.total_vote_stake = 0;
    app.vote_acc_reward_per_share = 0;
    app.total_tag_stake = 0;
    app.tags_acc_reward_per_share = 0;
    app.bump = ctx.bumps.app;
    Ok(())
}
