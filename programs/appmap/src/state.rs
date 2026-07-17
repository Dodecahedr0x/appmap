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

/// One `AppTagAccount` per (app, tag) pairing — anyone can suggest a tag for
/// an app, creating one of these. Tracks the tag's own locked stake
/// principal (in `principal_vault`) separately per tag, even though the
/// REWARD accumulator for all of an app's tags is shared at the
/// `AppAccount` level (`tags_acc_reward_per_share`) — see the design doc:
/// "the tags-pool is shared across all of an app's tags." `StakePosition`
/// (Task 17) will therefore checkpoint against `AppAccount`'s shared
/// accumulator, not a per-tag one, even though the principal it stakes sits
/// in this account's `principal_vault`.
#[account]
pub struct AppTagAccount {
    pub app: Pubkey,
    /// Off-chain tag identifier (a Prisma tag slug). Capped at
    /// `MAX_TAG_ID_LEN` bytes — same PDA-seed constraint as `AppAccount::app_id`.
    pub tag_id: String,
    /// Vault holding this tag's locked stake principal (seeds:
    /// `[TAG_VAULT_SEED, app_tag]`), authority = this `AppTagAccount` PDA.
    pub principal_vault: Pubkey,
    pub stake_amount: u64,
    /// PDA bump. IMPORTANT for CPI signing: this account's derivation seeds
    /// are `[TAG_SEED, app.as_ref(), tag_id.as_bytes()]`, NOT the account's
    /// own pubkey (same footgun class as `AppAccount::bump` — see that
    /// comment). Any instruction that needs this `app_tag` PDA to sign a CPI
    /// (e.g. Task 17's `withdraw_tag_stake`, transferring out of
    /// `principal_vault`, whose `token::authority = app_tag`) must sign with
    /// `&[TAG_SEED, app_tag.app.as_ref(), app_tag.tag_id.as_bytes(), &[app_tag.bump]]`
    /// — using `app_tag.key()` instead of `app_tag.app.as_ref()` will fail
    /// signature verification. Conveniently, `app_tag.app` (the stored field)
    /// already equals the `app.key()` used at derivation time, so reading it
    /// straight off this account (rather than re-deriving or threading
    /// `app_id` through) is both correct and the natural way to build the
    /// seeds.
    ///
    /// This is a DIFFERENT signing authority from `AppAccount::bump`'s: the
    /// `app` PDA signs for `vote_vault`/`vote_reward_vault`/`tags_reward_vault`,
    /// while the `app_tag` PDA signs only for its own `principal_vault`. Do
    /// not conflate the two when wiring up CPIs.
    pub bump: u8,
}

impl AppTagAccount {
    /// app (32) + tag_id (4-byte Borsh length prefix + up to `MAX_TAG_ID_LEN`
    /// (32) bytes content) + principal_vault (32) + stake_amount (8) +
    /// bump (1) = 32 + 36 + 32 + 8 + 1 = 109 bytes. Mirrors how
    /// `AppAccount::SPACE` accounts for its own `app_id: String` field (a
    /// 4-byte length prefix plus up to `MAX_APP_ID_LEN` bytes of content).
    pub const SPACE: usize = 32 + (4 + 32) + 32 + 8 + 1;
}

/// One `StakePosition` per (app_tag, user) pair, tracking a user's locked
/// tag-stake principal in `AppTagAccount::principal_vault` and the
/// accumulator checkpoint needed to compute rewards owed from
/// `AppAccount::tags_reward_vault` — the tag-staking mirror of
/// `VotePosition`. Seeds: `[STAKE_POSITION_SEED, app_tag.key(), user.key()]`.
/// Like `VotePosition`, this PDA never needs to sign a CPI, so keying off
/// `app_tag.key()` (rather than `app_tag.app`/`app_tag.tag_id`) carries none
/// of the CPI-signing footgun documented on `AppTagAccount::bump` — it's
/// simply a uniqueness key per user-per-tag.
///
/// The checkpoint here is against `AppAccount::tags_acc_reward_per_share`
/// (the shared accumulator across all of an app's tags), NOT a per-tag
/// accumulator, even though the principal this position represents sits in
/// a per-tag `principal_vault` — see the design note on `AppTagAccount`.
#[account]
pub struct StakePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    pub bump: u8,
}

impl StakePosition {
    pub const SPACE: usize = 32 + 8 + 16 + 1;
}

/// Selects which of `AppAccount`'s two reward pools an instruction operates
/// on. Introduced by `fund_app_rewards` (Task 15), which needs to fund
/// either pool through one instruction rather than two near-duplicate ones.
/// `Tags` is scaffolded now even though `AppTagAccount`/tag-staking
/// (`total_tag_stake` ever becoming nonzero) don't exist until Tasks 16-18,
/// specifically so `fund_app_rewards` doesn't need a breaking-change
/// migration once tag staking lands.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RewardPool {
    Vote,
    Tags,
}
