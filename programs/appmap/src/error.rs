use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol fee must not exceed 10,000 basis points (100%)")]
    InvalidFeeBps,
    #[msg("Signer is not the program's upgrade authority")]
    Unauthorized,
    #[msg("app_id must not exceed 32 bytes")]
    AppIdTooLong,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Withdrawal amount exceeds the position's staked amount")]
    InsufficientStake,
}
