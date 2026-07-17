use anchor_lang::prelude::*;

use crate::constants::{APP_SEED, APP_TAG_STAKE_SEED, MAX_TAG_ID_LEN, TAG_SEED};
use crate::error::ErrorCode;
use crate::state::{AppAccount, AppTagStake, Tag};

/// `suggest_tag` mirrors `init_app`: it is intentionally PERMISSIONLESS.
/// Anyone may propose any `tag_id` for any existing `app` by paying for the
/// account creation(s) below — there is no authority/signer-identity check
/// here, and there must never be one, for the same crowd-submission reasons
/// documented on `InitApp`.
///
/// Creates up to two accounts:
/// - `tag`: the GLOBAL tag identity (seeds: `[TAG_SEED, tag_id]`, no `app`).
///   `init_if_needed` because the same tag may already have been suggested
///   for a different app — see the design note on `Tag`.
/// - `app_tag_stake`: the stake accounting for THIS (app, tag) pair (seeds:
///   `[APP_TAG_STAKE_SEED, app.key(), tag.key()]`). Plain `init` — the same
///   app suggesting the same tag twice must fail.
///
/// No vault is created here: tag-stake principal shares the single global
/// vault documented on `Config`.
#[derive(Accounts)]
#[instruction(app_id: String, tag_id: String)]
pub struct SuggestTag<'info> {
    #[account(seeds = [APP_SEED, app_id.as_bytes()], bump = app.bump)]
    pub app: Account<'info, AppAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Tag::SPACE,
        seeds = [TAG_SEED, tag_id.as_bytes()],
        bump,
    )]
    pub tag: Account<'info, Tag>,
    #[account(
        init,
        payer = payer,
        space = 8 + AppTagStake::SPACE,
        seeds = [APP_TAG_STAKE_SEED, app.key().as_ref(), tag.key().as_ref()],
        bump,
    )]
    pub app_tag_stake: Account<'info, AppTagStake>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SuggestTag>, _app_id: String, tag_id: String) -> Result<()> {
    // Same ordering caveat as init_app's AppIdTooLong check — see that
    // file's detailed comment. This require! is a documented backstop, not
    // an effective guard (Anchor's PDA seed derivation for `tag` panics on
    // an oversized `tag_id` before this line ever runs).
    require!(
        tag_id.len() <= MAX_TAG_ID_LEN as usize,
        ErrorCode::TagIdTooLong
    );

    // Idempotent write, safe whether `tag` was just created or already
    // existed: `tag_id` is exactly the string that seeds-derived this exact
    // `tag` PDA address (Anchor's seeds constraint already enforced that on
    // both the init and the existing-load path), so re-writing it is a
    // harmless no-op when it already existed and the correct write when
    // freshly created.
    let tag = &mut ctx.accounts.tag;
    tag.tag_id = tag_id;
    tag.bump = ctx.bumps.tag;

    let app_tag_stake = &mut ctx.accounts.app_tag_stake;
    app_tag_stake.app = ctx.accounts.app.key();
    app_tag_stake.tag = ctx.accounts.tag.key();
    app_tag_stake.stake_amount = 0;
    app_tag_stake.bump = ctx.bumps.app_tag_stake;
    Ok(())
}
