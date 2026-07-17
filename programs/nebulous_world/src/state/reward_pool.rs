use anchor_lang::prelude::*;

/// Selects which of `AppAccount`'s two reward pools `fund_app_rewards`
/// bumps the accumulator for. Both pools are funded into the same single
/// global vault (see `Config`) — this enum only ever picks an accounting
/// target, never a vault.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RewardPool {
    Vote,
    Tags,
}
