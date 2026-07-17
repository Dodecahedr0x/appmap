use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::constants::CONFIG_SEED;
use crate::error::ErrorCode;
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub vote_mint: Account<'info, Mint>,
    /// The nebulous_world program itself, used only to look up its `ProgramData`
    /// account so we can verify `authority` is the program's upgrade
    /// authority. This closes the front-running window where anyone could
    /// otherwise race the legitimate deployer to call `initialize` first and
    /// permanently seize `Config.authority`.
    ///
    /// Deployment ordering matters: `initialize` must be called before the
    /// upgrade authority is ever revoked/finalized. Once
    /// `upgrade_authority_address` is `None`, this constraint can never be
    /// satisfied again and `Config` (a fixed-address PDA) can never be
    /// created — finalizing the program before initializing it permanently
    /// bricks deployment.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::Unauthorized)]
    pub program: Program<'info, crate::program::NebulousWorld>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ErrorCode::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
    require!(protocol_fee_bps <= 10_000, ErrorCode::InvalidFeeBps);
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.vote_mint = ctx.accounts.vote_mint.key();
    config.protocol_fee_bps = protocol_fee_bps;
    config.bump = ctx.bumps.config;
    Ok(())
}
