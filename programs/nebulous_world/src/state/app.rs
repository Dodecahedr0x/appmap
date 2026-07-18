use anchor_lang::prelude::*;

/// One `AppAccount` per crowd-submitted app, keyed by a client-chosen
/// `app_id` (≤32 bytes — the same string becomes the app's Postgres row id
/// once the indexer observes this account). Registration is on-chain-first:
/// the app's `App` row does not exist until the indexer's account
/// pipeline (`indexer/src/processors/account.rs`) sees this account and
/// creates it — there is no seed script and no direct Prisma write from the
/// app's own API for app creation. Pure accounting otherwise — it holds no
/// vault pubkeys of its own; every token movement it's party to goes
/// through the single global vault documented on `Config`. Holds the
/// accumulator state used to distribute rewards proportionally to stake
/// (the standard "reward per share" pattern: whenever rewards are funded,
/// `*_acc_reward_per_share` is bumped by `amount * PRECISION /
/// total_*_stake`, and each staker's claimable reward is derived from the
/// delta since their last checkpoint).
#[account]
pub struct AppAccount {
    /// The variable seed used to derive this PDA (seeds: `[APP_SEED,
    /// app_id.as_bytes()]`). Capped at 32 bytes — see `MAX_APP_ID_LEN` —
    /// since it is also used directly as a PDA seed, which has a hard
    /// 32-byte-per-seed limit. Chosen client-side before this account is
    /// created (there is no off-chain row yet to derive it from), and
    /// reused as the Postgres `App.id` once the indexer indexes this
    /// account.
    pub app_id: String,
    /// The app's URL with the `https://` protocol trimmed off to save
    /// rent-space (every app is assumed to be served over https — see
    /// `indexer/src/api.rs`'s `init_app_ix`, which does the trimming, and
    /// the indexer's account processor, which prepends it back when
    /// mirroring this into Postgres). Capped at `MAX_URL_LEN` bytes.
    pub url: String,
    pub total_vote_stake: u64,
    pub vote_acc_reward_per_share: u128,
    pub total_tag_stake: u64,
    pub tags_acc_reward_per_share: u128,
    /// PDA bump for `[APP_SEED, app_id.as_bytes()]`.
    pub bump: u8,
}

impl AppAccount {
    /// 4 bytes = Borsh string length prefix, per `String` field. `app_id` is
    /// capped at `MAX_APP_ID_LEN` (32) bytes (the Solana PDA per-seed
    /// limit); `url` at `MAX_URL_LEN` (200) bytes.
    pub const SPACE: usize = (4 + 32) + (4 + 200) + 8 + 16 + 8 + 16 + 1;
}
