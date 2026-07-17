use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::NEB_POOL_SEED;
use crate::error::ErrorCode;
use crate::pool_math::compute_buy_out;
use crate::state::NebPool;

/// Permissionless: anyone with SOL and an existing NEB associated token
/// account may buy, same crowd-facing shape as `vote`/`stake_tag` (no
/// authority check here, unlike `init_neb_pool`).
#[derive(Accounts)]
pub struct BuyNeb<'info> {
    #[account(mut, seeds = [NEB_POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, NebPool>,
    #[account(mut, address = pool.token_vault)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Buys NEB with `sol_amount` lamports off the bonding curve (see
/// `pool_math::compute_buy_out`). The quote is computed from the pool's
/// state BEFORE this trade, then real SOL moves buyer -> pool PDA, then NEB
/// moves pool vault -> buyer, signed by the pool PDA's own derivation seeds
/// (`[NEB_POOL_SEED, bump]` — a fixed, no-instruction-arg seed unlike
/// `AppAccount`'s `app_id`-keyed one, since this pool is a singleton).
pub fn handler(ctx: Context<BuyNeb>, sol_amount: u64) -> Result<()> {
    let tokens_out = compute_buy_out(
        ctx.accounts.pool.total_supply,
        ctx.accounts.pool.remaining_supply,
        ctx.accounts.pool.virtual_sol_reserves,
        ctx.accounts.pool.sol_raised,
        sol_amount,
    )?;

    // Pull SOL from the buyer into the pool PDA first. The pool account is
    // owned by this program (not the System Program), but System::transfer
    // only requires the SOURCE to be a system account/signer — the
    // destination's owner is irrelevant to receiving lamports, so this is
    // safe without any PDA signer seeds.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            SystemTransfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.pool.to_account_info(),
            },
        ),
        sol_amount,
    )?;

    // ...then pay out NEB, signed by the pool PDA.
    let bump_seed = [ctx.accounts.pool.bump];
    let seeds: &[&[u8]] = &[NEB_POOL_SEED, &bump_seed];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        tokens_out,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.remaining_supply = pool
        .remaining_supply
        .checked_sub(tokens_out)
        .ok_or(ErrorCode::MathOverflow)?;
    pool.sol_raised = pool
        .sol_raised
        .checked_add(sol_amount)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}
