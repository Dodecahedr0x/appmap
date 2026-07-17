use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub vote_mint: Pubkey,
    pub protocol_fee_bps: u16,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 32 + 2 + 1;
}

/// One `AppAccount` per crowd-submitted app, keyed by an off-chain `app_id`
/// (a Prisma cuid, ~25 bytes). Holds the three token vaults the app's
/// vote/stake/reward instructions operate on, plus the accumulator state
/// used to distribute rewards proportionally to stake (the standard
/// "reward per share" pattern: whenever rewards are funded, `*_acc_reward_per_share`
/// is bumped by `amount * PRECISION / total_*_stake`, and each staker's
/// claimable reward is derived from the delta since their last checkpoint).
#[account]
pub struct AppAccount {
    /// Off-chain identifier (Prisma cuid) this account was derived from.
    /// Capped at 32 bytes — see `MAX_APP_ID_LEN` — since it is also used
    /// directly as a PDA seed, which has a hard 32-byte-per-seed limit.
    pub app_id: String,
    /// Vault holding locked vote-stake principal (seeds: `[VOTE_VAULT_SEED, app]`).
    pub vote_vault: Pubkey,
    /// Vault holding funded vote-pool rewards awaiting claim (seeds: `[VOTE_REWARD_VAULT_SEED, app]`).
    pub vote_reward_vault: Pubkey,
    /// Vault holding funded tags-pool rewards awaiting claim, shared across
    /// all of this app's tags (seeds: `[TAGS_REWARD_VAULT_SEED, app]`).
    pub tags_reward_vault: Pubkey,
    pub total_vote_stake: u64,
    pub vote_acc_reward_per_share: u128,
    pub total_tag_stake: u64,
    pub tags_acc_reward_per_share: u128,
    /// PDA bump. IMPORTANT for CPI signing: this account's derivation seeds are
    /// `[APP_SEED, app_id.as_bytes()]`, NOT the account's own pubkey. Any
    /// instruction that needs this PDA to sign a CPI (e.g. transferring out of
    /// vote_vault/vote_reward_vault/tags_reward_vault) must sign with
    /// `&[APP_SEED, app_id.as_bytes(), &[bump]]` — using `app.key()` instead of
    /// `app_id.as_bytes()` will fail signature verification.
    pub bump: u8,
}

impl AppAccount {
    /// 4 bytes = Borsh string length prefix; `app_id` is capped at
    /// `MAX_APP_ID_LEN` (32) bytes, the Solana PDA per-seed limit.
    pub const SPACE: usize = 4 + 32 + 32 + 32 + 32 + 8 + 16 + 8 + 16 + 1;
}

/// One `VotePosition` per (app, user) pair, tracking a user's locked
/// vote-stake principal in `AppAccount::vote_vault` and the accumulator
/// checkpoint needed to compute rewards owed from `AppAccount::vote_reward_vault`.
/// Seeds: `[VOTE_POSITION_SEED, app.key(), user.key()]` — unlike `AppAccount`,
/// this PDA never needs to sign a CPI, so deriving it from `app.key()`
/// (rather than `app_id` bytes) carries none of the footgun documented on
/// `AppAccount::bump`; it's simply a uniqueness key per user-per-app.
#[account]
pub struct VotePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    pub bump: u8,
}

impl VotePosition {
    pub const SPACE: usize = 32 + 8 + 16 + 1;
}
