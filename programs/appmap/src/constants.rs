use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const APP_SEED: &[u8] = b"app";

#[constant]
pub const VOTE_VAULT_SEED: &[u8] = b"vote_vault";

#[constant]
pub const VOTE_REWARD_VAULT_SEED: &[u8] = b"vote_reward_vault";

#[constant]
pub const TAGS_REWARD_VAULT_SEED: &[u8] = b"tags_reward_vault";

#[constant]
pub const VOTE_POSITION_SEED: &[u8] = b"vote_pos";

/// Solana PDA seeds are capped at 32 bytes each. `app_id` (a Prisma cuid,
/// ~25 bytes) is used directly as a seed for the `AppAccount` PDA, so it
/// must never exceed this.
#[constant]
pub const MAX_APP_ID_LEN: u8 = 32;

/// Fixed-point scale for the reward-per-share accumulator math (see
/// `reward_math.rs`). 1e12 gives ample precision for token amounts with up to
/// ~9 decimals without overflowing u128 arithmetic at realistic scales.
///
/// Not annotated `#[constant]`: that attribute exists so a value is emitted
/// into the IDL for client-side PDA derivation (seeds, discriminators, etc).
/// `REWARD_PRECISION` is pure on-chain math, never used as a seed or needed
/// by clients, so a plain `pub const` is the right fit here.
pub const REWARD_PRECISION: u128 = 1_000_000_000_000;
