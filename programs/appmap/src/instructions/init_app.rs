use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{
    APP_SEED, CONFIG_SEED, MAX_APP_ID_LEN, TAGS_REWARD_VAULT_SEED, VOTE_REWARD_VAULT_SEED,
    VOTE_VAULT_SEED,
};
use crate::error::ErrorCode;
use crate::state::{AppAccount, Config};

/// `init_app` is intentionally PERMISSIONLESS: apps are crowd-submitted, so
/// anyone may register any `app_id` by paying for the account creation.
/// Unlike `initialize` (which protects the one global `Config` singleton),
/// there is no authority/signer-identity check here, and there must never
/// be one — gating this would contradict the crowd-submission product
/// design.
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
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        seeds = [VOTE_VAULT_SEED, app.key().as_ref()],
        bump,
        token::mint = vote_mint,
        token::authority = app,
    )]
    pub vote_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [VOTE_REWARD_VAULT_SEED, app.key().as_ref()],
        bump,
        token::mint = vote_mint,
        token::authority = app,
    )]
    pub vote_reward_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [TAGS_REWARD_VAULT_SEED, app.key().as_ref()],
        bump,
        token::mint = vote_mint,
        token::authority = app,
    )]
    pub tags_reward_vault: Account<'info, TokenAccount>,
    #[account(address = config.vote_mint)]
    pub vote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitApp>, app_id: String) -> Result<()> {
    // NOTE on ordering: this check cannot actually prevent the failure mode
    // it names. Anchor's generated `try_accounts` resolves every `init`
    // field (including `app`'s PDA derivation via
    // `Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], ..)`)
    // *before* the handler body — or any non-`init` field's `constraint = `
    // check — ever runs (verified by inspecting anchor-syn's
    // `codegen::accounts::try_accounts::generate_constraints`, which always
    // emits all `init` fields' checks ahead of all other fields' checks,
    // regardless of struct declaration order). `find_program_address`
    // panics if a seed exceeds Solana's 32-byte-per-seed limit, so an
    // oversized `app_id` aborts the transaction during account validation,
    // surfacing as an opaque runtime failure rather than `AppIdTooLong`.
    // There is no `#[account(...)]`-level hook in this Anchor version that
    // runs before a same-struct `init` PDA's seed derivation, short of
    // hand-rolling `app`'s account creation instead of using `init` — not
    // worth the complexity for an edge case Prisma cuids (~25 bytes) don't
    // hit in practice. This `require!` is kept as documentation of the
    // invariant and a backstop against future refactors (e.g. an `if_needed`
    // variant, or reordering that defers `app`'s creation past this point).
    require!(
        app_id.len() <= MAX_APP_ID_LEN as usize,
        ErrorCode::AppIdTooLong
    );

    let app = &mut ctx.accounts.app;
    app.app_id = app_id;
    app.vote_vault = ctx.accounts.vote_vault.key();
    app.vote_reward_vault = ctx.accounts.vote_reward_vault.key();
    app.tags_reward_vault = ctx.accounts.tags_reward_vault.key();
    app.total_vote_stake = 0;
    app.vote_acc_reward_per_share = 0;
    app.total_tag_stake = 0;
    app.tags_acc_reward_per_share = 0;
    app.bump = ctx.bumps.app;
    Ok(())
}
