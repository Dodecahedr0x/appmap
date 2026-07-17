use anchor_lang::prelude::*;

/// One `AppAccount` per crowd-submitted app, keyed by an off-chain `app_id`
/// (a Prisma cuid, ~25 bytes). Pure accounting — it holds no vault pubkeys
/// of its own; every token movement it's party to goes through the single
/// global vault documented on `Config`. Holds the accumulator state used to
/// distribute rewards proportionally to stake (the standard "reward per
/// share" pattern: whenever rewards are funded, `*_acc_reward_per_share` is
/// bumped by `amount * PRECISION / total_*_stake`, and each staker's
/// claimable reward is derived from the delta since their last checkpoint).
#[account]
pub struct AppAccount {
    /// Off-chain identifier (Prisma cuid) this account was derived from —
    /// the variable seed used to derive this PDA (seeds: `[APP_SEED,
    /// app_id.as_bytes()]`). Capped at 32 bytes — see `MAX_APP_ID_LEN` —
    /// since it is also used directly as a PDA seed, which has a hard
    /// 32-byte-per-seed limit.
    pub app_id: String,
    pub total_vote_stake: u64,
    pub vote_acc_reward_per_share: u128,
    pub total_tag_stake: u64,
    pub tags_acc_reward_per_share: u128,
    /// PDA bump for `[APP_SEED, app_id.as_bytes()]`.
    pub bump: u8,
}

impl AppAccount {
    /// 4 bytes = Borsh string length prefix; `app_id` is capped at
    /// `MAX_APP_ID_LEN` (32) bytes, the Solana PDA per-seed limit.
    pub const SPACE: usize = 4 + 32 + 8 + 16 + 8 + 16 + 1;
}
