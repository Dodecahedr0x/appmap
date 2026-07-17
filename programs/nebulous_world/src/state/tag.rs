use anchor_lang::prelude::*;

/// A GLOBAL tag identity — one `Tag` account per unique `tag_id` string
/// across the whole program, seeded ONLY by the tag string itself (seeds:
/// `[TAG_SEED, tag_id.as_bytes()]`, no `app` in the derivation). Unlike the
/// old per-(app, tag) design, the same tag is one shared account no matter
/// how many apps suggest it; per-app stake accounting for a tag lives on
/// `AppTagStake` instead. `suggest_tag` creates this the first time any app
/// suggests a given `tag_id` (`init_if_needed`) and re-derives/re-verifies
/// it (a harmless idempotent write) on every subsequent suggestion of the
/// same tag by another app.
#[account]
pub struct Tag {
    /// The variable seed used to derive this PDA. Capped at
    /// `MAX_TAG_ID_LEN` (32) bytes — same PDA-seed constraint as
    /// `AppAccount::app_id`.
    pub tag_id: String,
    /// PDA bump for `[TAG_SEED, tag_id.as_bytes()]`.
    pub bump: u8,
}

impl Tag {
    pub const SPACE: usize = 4 + 32 + 1;
}
