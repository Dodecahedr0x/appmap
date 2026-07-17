use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{APP_SEED, CONFIG_SEED, MAX_TAG_ID_LEN, TAG_SEED, TAG_VAULT_SEED};
use crate::error::ErrorCode;
use crate::state::{AppAccount, AppTagAccount, Config};

/// `suggest_tag` mirrors `init_app`: it is intentionally PERMISSIONLESS.
/// Anyone may propose any `tag_id` for any existing `app` by paying for the
/// `AppTagAccount` + `principal_vault` creation — there is no
/// authority/signer-identity check here, and there must never be one, for
/// the same crowd-submission reasons documented on `InitApp`.
///
/// Unlike `init_app` (which creates three vaults shared across an app's
/// lifetime), this only creates ONE vault: `principal_vault`. The reward
/// side (`tags_reward_vault`, `tags_acc_reward_per_share`) already exists on
/// `AppAccount` and is shared across all of an app's tags — see the doc
/// comment on `AppTagAccount`.
#[derive(Accounts)]
#[instruction(app_id: String, tag_id: String)]
pub struct SuggestTag<'info> {
    #[account(seeds = [APP_SEED, app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + AppTagAccount::SPACE,
        seeds = [TAG_SEED, app.key().as_ref(), tag_id.as_bytes()],
        bump,
    )]
    pub app_tag: Account<'info, AppTagAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        seeds = [TAG_VAULT_SEED, app_tag.key().as_ref()],
        bump,
        token::mint = vote_mint,
        token::authority = app_tag,
    )]
    pub principal_vault: Account<'info, TokenAccount>,
    #[account(address = config.vote_mint)]
    pub vote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SuggestTag>, _app_id: String, tag_id: String) -> Result<()> {
    // Same ordering caveat as init_app's AppIdTooLong check — see that
    // file's detailed comment. This require! is a documented backstop, not
    // an effective guard (Anchor's PDA seed derivation for `app_tag` panics
    // on an oversized `tag_id` before this line ever runs).
    require!(
        tag_id.len() <= MAX_TAG_ID_LEN as usize,
        ErrorCode::TagIdTooLong
    );

    let app_tag = &mut ctx.accounts.app_tag;
    app_tag.app = ctx.accounts.app.key();
    app_tag.tag_id = tag_id;
    app_tag.principal_vault = ctx.accounts.principal_vault.key();
    app_tag.stake_amount = 0;
    app_tag.bump = ctx.bumps.app_tag;
    Ok(())
}
