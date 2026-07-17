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
    pub bump: u8,
}

impl VotePosition {
    pub const SPACE: usize = 32 + 32 + 8 + 16 + 1;
}
