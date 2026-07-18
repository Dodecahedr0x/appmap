//! `POST /x402/settle` — verifies and submits the payment transaction
//! behind `/api/data/*` (see `app/src/lib/x402.ts` for the pricing/protocol
//! side, and its module doc for why this doesn't use a hosted facilitator).
//! `/tx/submit` in `src/api.rs` already relays an already-signed
//! transaction the same way; this differs only in that it also validates
//! *what* the transaction does before relaying it, since here (unlike
//! `/tx/submit`'s own instruction-building endpoints) the server didn't
//! build the transaction itself and can't otherwise vouch for its shape.

use crate::api::{associated_token_address, bad_request, internal, ApiError, ApiState, TOKEN_PROGRAM_ID};
use axum::extract::{Json, State};
use axum::routing::post;
use axum::Router;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;
use std::str::FromStr;
use std::sync::Arc;

const COMPUTE_BUDGET_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ComputeBudget111111111111111111111111111111");

// SPL Token program instruction tags this accepts — see
// https://docs.rs/spl-token/latest/spl_token/instruction/enum.TokenInstruction.html.
// Hand-decoded rather than pulling in the `spl-token` crate: this wire
// format has been stable for years, and spl-token's own `solana-program`
// dependency predates the split `solana-*` v3 crates this indexer already
// pins — adding it risks a version conflict for no real benefit here.
const SPL_TRANSFER_TAG: u8 = 3;
const SPL_TRANSFER_CHECKED_TAG: u8 = 12;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleReq {
    signed_transaction: String,
    /// Raw on-chain amount as a decimal string — see indexerClient.ts's
    /// convention for u64s that can exceed JS's safe integer range.
    expected_amount_raw: String,
    expected_mint: String,
    expected_pay_to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleDto {
    settled: bool,
    transaction: String,
}

/// What a payment transaction must look like: zero or more ComputeBudget
/// instructions (inert — they only tune compute unit price/limit, never
/// move funds) followed by exactly one Token-program `Transfer` or
/// `TransferChecked` instruction moving `expected_amount` into
/// `expected_pay_to`'s canonical associated token account for
/// `expected_mint`. Anything else — an extra instruction, a second
/// transfer, the wrong amount, the wrong destination — is rejected before
/// the transaction is ever submitted. Pure and RPC-free by design so it's
/// unit-testable against hand-built transactions without a live cluster
/// (see the tests below).
fn validate_payment_transaction(
    tx: &Transaction,
    expected_amount: u64,
    expected_mint: &Pubkey,
    expected_pay_to: &Pubkey,
) -> Result<(), String> {
    let expected_destination = associated_token_address(expected_pay_to, expected_mint);
    let keys = &tx.message.account_keys;
    let mut transfer_seen = false;

    for ix in &tx.message.instructions {
        let program_id = keys
            .get(ix.program_id_index as usize)
            .ok_or_else(|| "instruction references an out-of-range program id".to_string())?;

        if *program_id == COMPUTE_BUDGET_PROGRAM_ID {
            continue;
        }
        if *program_id != TOKEN_PROGRAM_ID {
            return Err(format!("unexpected instruction for program {program_id}"));
        }
        if transfer_seen {
            return Err("more than one Token program instruction".to_string());
        }

        // Transfer: accounts = [source, destination, authority, ...].
        // TransferChecked: accounts = [source, mint, destination, authority, ...] —
        // one extra (mint) account ahead of the destination.
        let (tag, destination_index) = match ix.data.first() {
            Some(&SPL_TRANSFER_TAG) if ix.data.len() >= 9 => (SPL_TRANSFER_TAG, 1usize),
            Some(&SPL_TRANSFER_CHECKED_TAG) if ix.data.len() >= 10 => (SPL_TRANSFER_CHECKED_TAG, 2usize),
            _ => return Err("not a Transfer/TransferChecked instruction".to_string()),
        };
        let amount = u64::from_le_bytes(ix.data[1..9].try_into().unwrap());
        if amount != expected_amount {
            return Err(format!("amount {amount} does not match expected {expected_amount}"));
        }

        let destination_account_index = *ix
            .accounts
            .get(destination_index)
            .ok_or_else(|| "instruction missing its destination account".to_string())?;
        let destination = keys
            .get(destination_account_index as usize)
            .ok_or_else(|| "destination account index out of range".to_string())?;
        if *destination != expected_destination {
            return Err(format!(
                "destination {destination} is not {expected_pay_to}'s associated token account for {expected_mint}"
            ));
        }

        if tag == SPL_TRANSFER_CHECKED_TAG {
            let mint_account_index = *ix
                .accounts
                .get(1)
                .ok_or_else(|| "TransferChecked instruction missing its mint account".to_string())?;
            let mint = keys
                .get(mint_account_index as usize)
                .ok_or_else(|| "mint account index out of range".to_string())?;
            if mint != expected_mint {
                return Err(format!("mint {mint} does not match expected {expected_mint}"));
            }
        }

        transfer_seen = true;
    }

    if !transfer_seen {
        return Err("transaction contains no Token transfer instruction".to_string());
    }
    Ok(())
}

async fn settle(State(state): State<Arc<ApiState>>, Json(req): Json<SettleReq>) -> Result<Json<SettleDto>, ApiError> {
    let expected_amount: u64 = req
        .expected_amount_raw
        .parse()
        .map_err(|_| bad_request("expectedAmountRaw must be a raw u64 integer amount"))?;
    let expected_mint = Pubkey::from_str(&req.expected_mint).map_err(|e| bad_request(format!("invalid expectedMint: {e}")))?;
    let expected_pay_to =
        Pubkey::from_str(&req.expected_pay_to).map_err(|e| bad_request(format!("invalid expectedPayTo: {e}")))?;

    let bytes = BASE64
        .decode(req.signed_transaction)
        .map_err(|e| bad_request(format!("invalid base64: {e}")))?;
    let tx: Transaction = bincode::deserialize(&bytes).map_err(|e| bad_request(format!("invalid transaction: {e}")))?;

    validate_payment_transaction(&tx, expected_amount, &expected_mint, &expected_pay_to).map_err(bad_request)?;

    let signature = state.rpc.send_and_confirm_transaction(&tx).await.map_err(internal)?;
    Ok(Json(SettleDto {
        settled: true,
        transaction: signature.to_string(),
    }))
}

pub fn routes() -> Router<Arc<ApiState>> {
    Router::new().route("/x402/settle", post(settle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_hash::Hash;
    use solana_instruction::{AccountMeta, Instruction};
    use solana_message::Message;

    const AMOUNT: u64 = 10_000;

    fn keys() -> (Pubkey, Pubkey, Pubkey, Pubkey) {
        // payer, mint, pay_to (the treasury wallet), fee_payer/signer — a
        // fresh, deterministic-enough set of throwaway keys per test run.
        (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        )
    }

    fn transfer_checked_ix(source: Pubkey, mint: Pubkey, destination: Pubkey, authority: Pubkey, amount: u64) -> Instruction {
        let mut data = vec![SPL_TRANSFER_CHECKED_TAG];
        data.extend_from_slice(&amount.to_le_bytes());
        data.push(6); // decimals — unchecked by validate_payment_transaction itself
        Instruction::new_with_bytes(
            TOKEN_PROGRAM_ID,
            &data,
            vec![
                AccountMeta::new(source, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new(destination, false),
                AccountMeta::new_readonly(authority, true),
            ],
        )
    }

    fn transfer_ix(source: Pubkey, destination: Pubkey, authority: Pubkey, amount: u64) -> Instruction {
        let mut data = vec![SPL_TRANSFER_TAG];
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction::new_with_bytes(
            TOKEN_PROGRAM_ID,
            &data,
            vec![
                AccountMeta::new(source, false),
                AccountMeta::new(destination, false),
                AccountMeta::new_readonly(authority, true),
            ],
        )
    }

    fn compute_budget_ix() -> Instruction {
        Instruction::new_with_bytes(COMPUTE_BUDGET_PROGRAM_ID, &[3, 0, 0, 0, 0, 0, 0, 0, 0], vec![])
    }

    fn build_tx(instructions: &[Instruction], fee_payer: Pubkey) -> Transaction {
        let message = Message::new_with_blockhash(instructions, Some(&fee_payer), &Hash::default());
        Transaction::new_unsigned(message)
    }

    #[test]
    fn accepts_a_correct_transfer_checked() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let tx = build_tx(&[transfer_checked_ix(source, mint, destination, authority, AMOUNT)], authority);
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_ok());
    }

    #[test]
    fn accepts_a_correct_plain_transfer() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let tx = build_tx(&[transfer_ix(source, destination, authority, AMOUNT)], authority);
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_ok());
    }

    #[test]
    fn accepts_compute_budget_instructions_alongside_the_transfer() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let tx = build_tx(
            &[compute_budget_ix(), transfer_checked_ix(source, mint, destination, authority, AMOUNT)],
            authority,
        );
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_ok());
    }

    #[test]
    fn rejects_the_wrong_amount() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let tx = build_tx(&[transfer_checked_ix(source, mint, destination, authority, AMOUNT - 1)], authority);
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }

    #[test]
    fn rejects_a_destination_that_is_not_pay_tos_ata() {
        let (source, mint, pay_to, authority) = keys();
        let wrong_destination = Pubkey::new_unique();
        let tx = build_tx(&[transfer_checked_ix(source, mint, wrong_destination, authority, AMOUNT)], authority);
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }

    #[test]
    fn rejects_the_wrong_mint_in_transfer_checked() {
        let (source, mint, pay_to, authority) = keys();
        let other_mint = Pubkey::new_unique();
        // Destination derived for the WRONG mint too, so only the
        // TransferChecked mint-account check (not the destination check)
        // is what catches this.
        let destination = associated_token_address(&pay_to, &other_mint);
        let tx = build_tx(
            &[transfer_checked_ix(source, other_mint, destination, authority, AMOUNT)],
            authority,
        );
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }

    #[test]
    fn rejects_an_unrelated_extra_instruction() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let system_program = Pubkey::from_str_const("11111111111111111111111111111111111111");
        let sneaky = Instruction::new_with_bytes(system_program, &[2, 0, 0, 0], vec![AccountMeta::new(authority, true)]);
        let tx = build_tx(
            &[transfer_checked_ix(source, mint, destination, authority, AMOUNT), sneaky],
            authority,
        );
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }

    #[test]
    fn rejects_a_second_transfer_instruction() {
        let (source, mint, pay_to, authority) = keys();
        let destination = associated_token_address(&pay_to, &mint);
        let tx = build_tx(
            &[
                transfer_checked_ix(source, mint, destination, authority, AMOUNT),
                transfer_checked_ix(source, mint, destination, authority, AMOUNT),
            ],
            authority,
        );
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }

    #[test]
    fn rejects_a_transaction_with_no_transfer_at_all() {
        let (_, mint, pay_to, authority) = keys();
        let tx = build_tx(&[compute_budget_ix()], authority);
        assert!(validate_payment_transaction(&tx, AMOUNT, &mint, &pay_to).is_err());
    }
}
