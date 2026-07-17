pub mod constants;
pub mod error;
pub mod instructions;
pub mod pool_math;
pub mod reward_math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("EkQRRgRFd2FUedJnPVs2Xs6N7U2Jef5GrfwJ62UJZUXx");

#[program]
pub mod nebulous_world {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        initialize::handler(ctx, protocol_fee_bps)
    }

    pub fn init_app(ctx: Context<InitApp>, app_id: String) -> Result<()> {
        init_app::handler(ctx, app_id)
    }

    pub fn suggest_tag(ctx: Context<SuggestTag>, app_id: String, tag_id: String) -> Result<()> {
        suggest_tag::handler(ctx, app_id, tag_id)
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

    pub fn stake_tag(ctx: Context<StakeTag>, amount: u64) -> Result<()> {
        stake_tag::handler(ctx, amount)
    }

    pub fn withdraw_tag_stake(ctx: Context<WithdrawTagStake>, amount: u64) -> Result<()> {
        withdraw_tag_stake::handler(ctx, amount)
    }

    pub fn claim_tag_reward(ctx: Context<ClaimTagReward>) -> Result<()> {
        claim_tag_reward::handler(ctx)
    }

    pub fn init_neb_pool(
        ctx: Context<InitNebPool>,
        total_supply: u64,
        virtual_sol_reserves: u64,
    ) -> Result<()> {
        init_neb_pool::handler(ctx, total_supply, virtual_sol_reserves)
    }

    pub fn buy_neb(ctx: Context<BuyNeb>, sol_amount: u64) -> Result<()> {
        buy_neb::handler(ctx, sol_amount)
    }

    pub fn withdraw_pool_sol(ctx: Context<WithdrawPoolSol>, amount: u64) -> Result<()> {
        withdraw_pool_sol::handler(ctx, amount)
    }
}
