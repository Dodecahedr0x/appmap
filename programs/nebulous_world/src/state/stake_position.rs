use anchor_lang::prelude::*;

/// One `StakePosition` per (app_tag_stake, user) pair, tracking a user's
/// locked tag-stake principal (custody: the single global vault on `Config`)
/// and the accumulator checkpoint needed to compute rewards owed — the
/// tag-staking mirror of `VotePosition`. `app_tag_stake`/`owner` are the two
/// variable seeds used to derive this PDA (seeds: `[STAKE_POSITION_SEED,
/// app_tag_stake.key(), user.key()]`), stored so the account is
/// self-describing.
///
/// The checkpoint here is against `AppAccount::tags_acc_reward_per_share`
/// (the shared accumulator across all of an app's tags), NOT a per-(app,
/// tag) accumulator, even though the principal this position represents is
/// counted on a per-(app, tag) `AppTagStake` — see the design note there.
#[account]
pub struct StakePosition {
    pub app_tag_stake: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    /// Size-weighted-average deposit timestamp (Unix seconds) — see
    /// `unstake_fee::weighted_avg_timestamp`. Drives `withdraw_tag_stake`'s
    /// linearly-decaying unstake fee (`unstake_fee.rs`), the tag-staking
    /// mirror of `VotePosition::staked_at` — see that field's doc comment.
    pub staked_at: i64,
    pub bump: u8,
}

impl StakePosition {
    pub const SPACE: usize = 32 + 32 + 8 + 16 + 8 + 1;
}
