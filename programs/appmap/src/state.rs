use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub vote_mint: Pubkey,
    pub protocol_fee_bps: u16,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 32 + 2 + 1;
}
