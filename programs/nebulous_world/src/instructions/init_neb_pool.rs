use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{CONFIG_SEED, NEB_POOL_SEED, NEB_POOL_VAULT_SEED};
use crate::error::ErrorCode;
use crate::state::{Config, NebPool};

/// Authority-gated (`has_one = authority`, same idiom `fund_app_rewards`
/// uses): only `Config.authority` may seed the pool, and only once — `init`
/// on this fixed-seed singleton PDA fails outright on a second call, the
/// same protection `Config` itself relies on.
///
/// Single-sided by construction: `authority_token_account` transfers
/// `total_supply` NEB in, and NO SOL account is created or funded here —
/// `virtual_sol_reserves` is a plain instruction argument, never backed by a
/// real deposit. See `NebPool`'s doc comment for why that's sufficient to
/// define a starting price.
#[derive(Accounts)]
pub struct InitNebPool<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + NebPool::SPACE,
        seeds = [NEB_POOL_SEED],
        bump,
    )]
    pub pool: Account<'info, NebPool>,
    #[account(
        init,
        payer = authority,
        seeds = [NEB_POOL_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = vote_mint,
        token::authority = pool,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(address = config.vote_mint)]
    pub vote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitNebPool>,
    total_supply: u64,
    virtual_sol_reserves: u64,
) -> Result<()> {
    require!(total_supply > 0, ErrorCode::ZeroAmount);
    require!(virtual_sol_reserves > 0, ErrorCode::ZeroAmount);

    // Deposit the entire sale supply, signed by `authority` (the source
    // token account's owner) — no PDA signer seeds needed for this leg,
    // same "money coming in" shape as `vote()`'s principal transfer.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.authority_token_account.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        total_supply,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.mint = ctx.accounts.vote_mint.key();
    pool.token_vault = ctx.accounts.token_vault.key();
    pool.total_supply = total_supply;
    pool.remaining_supply = total_supply;
    pool.sol_raised = 0;
    pool.virtual_sol_reserves = virtual_sol_reserves;
    pool.bump = ctx.bumps.pool;
    Ok(())
}
