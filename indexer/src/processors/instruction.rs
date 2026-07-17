use carbon_core::error::CarbonResult;
use carbon_core::instruction::{DecodedInstruction, InstructionMetadata};
use carbon_nebulous_world_decoder::instructions::NebulousWorldInstruction;
use sqlx::PgPool;

fn instruction_name(instruction: &NebulousWorldInstruction) -> &'static str {
    match instruction {
        NebulousWorldInstruction::BuyNeb(_) => "buy_neb",
        NebulousWorldInstruction::ClaimTagReward(_) => "claim_tag_reward",
        NebulousWorldInstruction::ClaimVoteReward(_) => "claim_vote_reward",
        NebulousWorldInstruction::FundAppRewards(_) => "fund_app_rewards",
        NebulousWorldInstruction::InitApp(_) => "init_app",
        NebulousWorldInstruction::Initialize(_) => "initialize",
        NebulousWorldInstruction::InitNebPool(_) => "init_neb_pool",
        NebulousWorldInstruction::StakeTag(_) => "stake_tag",
        NebulousWorldInstruction::SuggestTag(_) => "suggest_tag",
        NebulousWorldInstruction::Vote(_) => "vote",
        NebulousWorldInstruction::WithdrawPoolSol(_) => "withdraw_pool_sol",
        NebulousWorldInstruction::WithdrawTagStake(_) => "withdraw_tag_stake",
        NebulousWorldInstruction::WithdrawVote(_) => "withdraw_vote",
    }
}

/// Appends one decoded instruction to `indexed_instruction` — "our program
/// changes" per the indexer's mandate, independent of the app's own
/// API-recorded ledger (see the migration's doc comment). Idempotent under
/// (signature, instruction_index), so the crawler re-processing a signature
/// after a restart (src/crawler.rs) never double-counts.
pub async fn index_instruction(
    pool: &PgPool,
    metadata: &InstructionMetadata,
    decoded: &DecodedInstruction<NebulousWorldInstruction>,
) -> CarbonResult<()> {
    let name = instruction_name(&decoded.data);
    let signature = metadata.transaction_metadata.signature.to_string();
    // Postgres BIGINT is signed i64; slot is realistically nowhere near
    // u64::MAX at Solana's actual pace, but reject rather than silently
    // wrap if that ever changes.
    let slot = i64::try_from(metadata.transaction_metadata.slot)
        .map_err(|_| carbon_core::error::Error::Custom("slot does not fit in BIGINT".into()))?;
    let block_time = metadata
        .transaction_metadata
        .block_time
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0));
    let data = serde_json::to_value(&decoded.data)
        .map_err(|e| carbon_core::error::Error::Custom(e.to_string()))?;
    let accounts = serde_json::to_value(
        decoded
            .accounts
            .iter()
            .map(|a| a.pubkey.to_string())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| carbon_core::error::Error::Custom(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO indexed_instruction
            (signature, instruction_index, slot, block_time, instruction_name, data, accounts)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (signature, instruction_index) DO NOTHING
        "#,
    )
    .bind(&signature)
    .bind(metadata.index as i32)
    .bind(slot)
    .bind(block_time)
    .bind(name)
    .bind(&data)
    .bind(&accounts)
    .execute(pool)
    .await
    .map_err(|e| carbon_core::error::Error::Custom(e.to_string()))?;

    log::debug!("indexed {name} instruction {signature} at slot {slot}");
    Ok(())
}
