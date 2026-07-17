pub mod constants;
pub mod error;
pub mod instructions;
pub mod reward_math;
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

    pub fn init_app(ctx: Context<InitApp>, app_id: String) -> Result<()> {
        init_app::handler(ctx, app_id)
    }

    pub fn vote(ctx: Context<Vote>, amount: u64) -> Result<()> {
        vote::handler(ctx, amount)
    }

    pub fn withdraw_vote(ctx: Context<WithdrawVote>, amount: u64) -> Result<()> {
        withdraw_vote::handler(ctx, amount)
    }

    pub fn fund_app_rewards(
        ctx: Context<FundAppRewards>,
        pool: RewardPool,
        amount: u64,
    ) -> Result<()> {
        fund_app_rewards::handler(ctx, pool, amount)
    }

    pub fn claim_vote_reward(ctx: Context<ClaimVoteReward>) -> Result<()> {
        claim_vote_reward::handler(ctx)
    }
}
