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

/// Solana PDA seeds are capped at 32 bytes each. `app_id` (a Prisma cuid,
/// ~25 bytes) is used directly as a seed for the `AppAccount` PDA, so it
/// must never exceed this.
#[constant]
pub const MAX_APP_ID_LEN: u8 = 32;
