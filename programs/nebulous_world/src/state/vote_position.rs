use anchor_lang::prelude::*;

/// One `VotePosition` per (app, user) pair, tracking a user's locked
/// vote-stake principal (custody: the single global vault on `Config`) and
/// the accumulator checkpoint needed to compute rewards owed. `app`/`owner`
/// are the two variable seeds used to derive this PDA (seeds:
/// `[VOTE_POSITION_SEED, app.key(), user.key()]`), stored so the account is
/// self-describing.
#[account]
pub struct VotePosition {
    pub app: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    /// Size-weighted-average deposit timestamp (Unix seconds) — see
    /// `unstake_fee::weighted_avg_timestamp`. Drives `withdraw_vote`'s
    /// linearly-decaying unstake fee (`unstake_fee.rs`): 1% immediately
    /// after a deposit, decaying to 0% over the following week. Updated on
    /// every `vote()` deposit; left unchanged by a withdrawal (a partial
    /// withdrawal doesn't reset the remaining balance's age).
    pub staked_at: i64,
    pub bump: u8,
}

impl VotePosition {
    pub const SPACE: usize = 32 + 32 + 8 + 16 + 8 + 1;
}
