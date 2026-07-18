use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const APP_SEED: &[u8] = b"app";

/// Seeds a GLOBAL `Tag` account: `[TAG_SEED, tag_id.as_bytes()]`, with no
/// `app` in the derivation. Tags are shared identities across every app that
/// suggests them — see the design note on `Tag`.
#[constant]
pub const TAG_SEED: &[u8] = b"tag";

/// Seeds the per-(app, tag) stake-accounting link: `[APP_TAG_STAKE_SEED,
/// app.key(), tag.key()]`. See the design note on `AppTagStake`.
#[constant]
pub const APP_TAG_STAKE_SEED: &[u8] = b"app_tag_stake";

#[constant]
pub const VOTE_POSITION_SEED: &[u8] = b"vote_pos";

#[constant]
pub const STAKE_POSITION_SEED: &[u8] = b"stake_pos";

/// Solana PDA seeds are capped at 32 bytes each. `app_id` (a Prisma cuid,
/// ~25 bytes) is used directly as a seed for the `AppAccount` PDA, so it
/// must never exceed this.
#[constant]
pub const MAX_APP_ID_LEN: u8 = 32;

/// Same 32-byte-per-seed constraint as `MAX_APP_ID_LEN`, applied to
/// `tag_id` (a Prisma tag slug), which is used directly as a seed for the
/// global `Tag` PDA.
#[constant]
pub const MAX_TAG_ID_LEN: u8 = 32;

/// `AppAccount::url` is not a PDA seed (only `app_id` is), so it isn't bound
/// by the 32-byte-per-seed limit — this is purely a rent/space budget cap.
/// 200 bytes comfortably fits any realistic URL once the `https://` prefix
/// is trimmed off before storage (see `indexer/src/api.rs`'s `init_app_ix`).
#[constant]
pub const MAX_URL_LEN: u16 = 200;

/// Fixed-point scale for the reward-per-share accumulator math (see
/// `reward_math.rs`). 1e12 gives ample precision for token amounts with up to
/// ~9 decimals without overflowing u128 arithmetic at realistic scales.
///
/// Not annotated `#[constant]`: that attribute exists so a value is emitted
/// into the IDL for client-side PDA derivation (seeds, discriminators, etc).
/// `REWARD_PRECISION` is pure on-chain math, never used as a seed or needed
/// by clients, so a plain `pub const` is the right fit here.
pub const REWARD_PRECISION: u128 = 1_000_000_000_000;

/// The unstake fee (see `unstake_fee.rs`) starts here — 100 bps = 1% — the
/// instant a position is opened/topped-up, and decays linearly to 0 over
/// `UNSTAKE_FEE_DECAY_SECONDS`. Same bps-out-of-10_000 convention as
/// `Config::protocol_fee_bps`.
pub const UNSTAKE_FEE_START_BPS: u16 = 100;

/// One week, in seconds — how long it takes `UNSTAKE_FEE_START_BPS` to decay
/// to 0. Not a `#[constant]`: pure on-chain math, never a PDA seed or a
/// value a client needs to derive an address from.
pub const UNSTAKE_FEE_DECAY_SECONDS: i64 = 7 * 24 * 60 * 60;
