use anchor_lang::prelude::*;

/// The one global singleton (seeds: `[CONFIG_SEED]`, no variable seeds).
/// `authority`/`vote_mint` double as the derivation inputs for the program's
/// single global token vault: an Associated Token Account owned by this PDA
/// (`config.key()`) for mint `vote_mint`. Every instruction that moves
/// tokens — vote stake, tag stake, vote rewards, tags rewards, all of it —
/// transfers through that ONE vault rather than a dedicated vault per app or
/// per tag, to avoid paying token-account rent per (app, tag) pair. Which
/// portion of the vault's balance belongs to whom is tracked entirely by the
/// accounting fields on `AppAccount`/`AppTagStake`/`VotePosition`/
/// `StakePosition` — never by splitting custody across separate accounts.
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub vote_mint: Pubkey,
    /// Set once at `initialize` and validated (`<= 10_000`) there, but not
    /// read by any instruction in this program — no instruction here ever
    /// skims a fee off a transfer. The actual protocol fee is computed and
    /// deducted OFF-CHAIN, on gross ad revenue, before `fund_app_rewards` is
    /// ever called: see `PROTOCOL_FEE` in `app/scripts/settleEpoch.ts` and
    /// `REVENUE_CONFIG.protocolFee` in `app/src/lib/revenue.ts` (the two
    /// must be kept in sync with each other, and this field is not the
    /// source of truth for either). Kept on-chain as a recorded/auditable
    /// parameter of the deployment, not as an enforcement point — do not
    /// assume changing this value would change the effective fee.
    pub protocol_fee_bps: u16,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 32 + 2 + 1;
}
