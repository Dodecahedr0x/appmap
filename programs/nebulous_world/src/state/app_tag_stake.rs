use anchor_lang::prelude::*;

/// The stake accounting for one (app, tag) connection — created by
/// `suggest_tag` alongside (but distinct from) the global `Tag` identity.
/// `app`/`tag` are the two variable seeds used to derive this PDA (seeds:
/// `[APP_TAG_STAKE_SEED, app.key(), tag.key()]`), stored so the account is
/// self-describing and so `stake_tag`/`withdraw_tag_stake`/
/// `claim_tag_reward` can re-derive/re-validate it from its own fields
/// without needing a separate `tag_id` instruction arg.
///
/// Tracks this tag's own locked stake principal (`stake_amount`) for this
/// specific app, even though the REWARD accumulator for all of an app's tags
/// is shared at the `AppAccount` level (`tags_acc_reward_per_share`) — see
/// the design note there. `StakePosition` checkpoints against
/// `AppAccount`'s shared accumulator, not a per-(app, tag) one, even though
/// the principal it stakes is counted here.
#[account]
pub struct AppTagStake {
    pub app: Pubkey,
    pub tag: Pubkey,
    pub stake_amount: u64,
    /// PDA bump for `[APP_TAG_STAKE_SEED, app.as_ref(), tag.as_ref()]`.
    pub bump: u8,
}

impl AppTagStake {
    pub const SPACE: usize = 32 + 32 + 8 + 1;
}
