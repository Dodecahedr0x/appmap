pub mod claim_vote_reward;
pub mod fund_app_rewards;
pub mod init_app;
pub mod initialize;
pub mod vote;
pub mod withdraw_vote;

// Each instruction module's `handler` fn is only ever called via its module
// path (e.g. `init_app::handler(..)` in `lib.rs`), never through this glob,
// so the modules' same-named `handler` fns colliding here is harmless —
// silence the resulting `ambiguous_glob_reexports` warning rather than
// hand-listing every macro-generated item (`__client_accounts_*`,
// `__cpi_client_accounts_*`, etc.) each instruction module needs re-exported
// for the `#[program]` macro to find via `crate::`.
#[allow(ambiguous_glob_reexports)]
mod reexports {
    pub use super::claim_vote_reward::*;
    pub use super::fund_app_rewards::*;
    pub use super::init_app::*;
    pub use super::initialize::*;
    pub use super::vote::*;
    pub use super::withdraw_vote::*;
}
pub use reexports::*;
