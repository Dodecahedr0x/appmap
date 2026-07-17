use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, NEB_POOL_SEED};
use crate::error::ErrorCode;
use crate::state::{Config, NebPool};

/// Authority-gated (same `has_one` idiom as `fund_app_rewards`/`init_neb_pool`):
/// withdraws real SOL raised by `buy_neb` out of the pool PDA's own balance.
///
/// `buy_neb` moves lamports into `pool` via a plain System Program transfer
/// (see its doc comment), which only works for money coming IN — the
/// System Program's `Transfer` instruction requires the source to be
/// owned by itself, so it cannot move lamports back OUT of `pool` (owned by
/// this program). Withdrawing therefore manipulates `pool`'s lamport
/// balance directly, which this program (as `pool`'s owner) is allowed to
/// do without any CPI or signer seeds — the standard pattern for a program
/// reclaiming SOL from its own PDA.
#[derive(Accounts)]
pub struct WithdrawPoolSol<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [NEB_POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, NebPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<WithdrawPoolSol>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let pool_ai = ctx.accounts.pool.to_account_info();
    let rent_exempt_minimum = Rent::get()?.minimum_balance(pool_ai.data_len());
    let available = pool_ai
        .lamports()
        .checked_sub(rent_exempt_minimum)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(amount <= available, ErrorCode::InsufficientPoolBalance);

    **pool_ai.try_borrow_mut_lamports()? -= amount;
    **ctx
        .accounts
        .authority
        .to_account_info()
        .try_borrow_mut_lamports()? += amount;

    Ok(())
}
