use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol fee must not exceed 10,000 basis points (100%)")]
    InvalidFeeBps,
    // Shared by `initialize` (must be the program's upgrade authority) and
    // `fund_app_rewards` (must be `Config.authority`, via `has_one`) — the
    // message is deliberately generic so it fits both authorization checks.
    #[msg("Signer is not authorized to perform this action")]
    Unauthorized,
    #[msg("app_id must not exceed 32 bytes")]
    AppIdTooLong,
    #[msg("tag_id must not exceed 32 bytes")]
    TagIdTooLong,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Withdrawal amount exceeds the position's staked amount")]
    InsufficientStake,
    #[msg("Cannot fund a reward pool that has no stakers")]
    NoStakers,
    #[msg("app_tag does not belong to the provided app")]
    TagAppMismatch,
    #[msg("The NEB pool has sold its entire supply")]
    PoolSoldOut,
    #[msg("SOL amount is too small to receive any NEB at the current price")]
    BuyTooSmall,
    #[msg("Requested withdrawal exceeds the pool's withdrawable SOL balance")]
    InsufficientPoolBalance,
}
