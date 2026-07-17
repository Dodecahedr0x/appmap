pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("EkQRRgRFd2FUedJnPVs2Xs6N7U2Jef5GrfwJ62UJZUXx");

#[program]
pub mod appmap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        initialize::handler(ctx, protocol_fee_bps)
    }
}
