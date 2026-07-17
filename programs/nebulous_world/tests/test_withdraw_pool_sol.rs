use {
    anchor_lang::solana_program::{
        bpf_loader_upgradeable::{self, UpgradeableLoaderState},
        program_option::COption,
        program_pack::Pack,
        pubkey::Pubkey,
        system_program,
    },
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    anchor_spl::token::ID as TOKEN_PROGRAM_ID,
    litesvm::LiteSVM,
    nebulous_world::constants::{CONFIG_SEED, NEB_POOL_SEED, NEB_POOL_VAULT_SEED},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint},
};

fn set_upgrade_authority(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    upgrade_authority: Pubkey,
) -> Pubkey {
    let program_data_address = bpf_loader_upgradeable::get_program_data_address(program_id);
    let mut account = svm
        .get_account(&program_data_address)
        .expect("programdata account must exist (call after add_program)");

    let header = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot: 0,
        upgrade_authority_address: Some(upgrade_authority),
    })
    .unwrap();
    account.data[..header.len()].copy_from_slice(&header);

    svm.set_account(program_data_address, account).unwrap();
    program_data_address
}

fn fund_token_account(svm: &mut LiteSVM, pubkey: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let token_account = SplTokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; SplTokenAccount::LEN];
    SplTokenAccount::pack(token_account, &mut data).unwrap();
    svm.set_account(
        pubkey,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(SplTokenAccount::LEN),
            data,
            owner: spl_token_interface::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn neb_pool_pdas(program_id: &Pubkey) -> (Pubkey, Pubkey) {
    let (pool, _) = Pubkey::find_program_address(&[NEB_POOL_SEED], program_id);
    let (vault, _) =
        Pubkey::find_program_address(&[NEB_POOL_VAULT_SEED, pool.as_ref()], program_id);
    (pool, vault)
}

/// Fresh LiteSVM with the nebulous_world program loaded, `Config` initialized
/// (deployer == Config.authority), a NEB pool seeded, and one buy already
/// executed — so `pool` holds some real, withdrawable SOL by the time each
/// test starts.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = nebulous_world::id();
    let deployer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/nebulous_world.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&deployer.pubkey(), 10_000_000_000).unwrap();

    let vote_mint = Pubkey::new_unique();
    let mint = Mint {
        mint_authority: COption::Some(deployer.pubkey()),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut mint_data = vec![0u8; Mint::LEN];
    Mint::pack(mint, &mut mint_data).unwrap();
    svm.set_account(
        vote_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(Mint::LEN),
            data: mint_data,
            owner: spl_token_interface::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let program_data = set_upgrade_authority(&mut svm, &program_id, deployer.pubkey());
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    let initialize_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::Initialize {
            protocol_fee_bps: 250,
        }
        .data(),
        nebulous_world::accounts::Initialize {
            config,
            authority: deployer.pubkey(),
            vote_mint,
            program: program_id,
            program_data,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[initialize_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("initialize must succeed in test setup");

    let (pool, token_vault) = neb_pool_pdas(&program_id);
    let total_supply = 1_000_000_000_000u64;
    let authority_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        authority_token_account,
        vote_mint,
        deployer.pubkey(),
        total_supply,
    );
    let init_pool_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitNebPool {
            total_supply,
            virtual_sol_reserves: 30_000_000_000,
        }
        .data(),
        nebulous_world::accounts::InitNebPool {
            config,
            pool,
            token_vault,
            vote_mint,
            authority_token_account,
            authority: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_pool_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("init_neb_pool must succeed in test setup");

    // One buy so the pool actually holds withdrawable SOL.
    let buyer = Keypair::new();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();
    let buyer_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, buyer_token_account, vote_mint, buyer.pubkey(), 0);
    let buy_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::BuyNeb {
            sol_amount: 2_000_000_000,
        }
        .data(),
        nebulous_world::accounts::BuyNeb {
            pool,
            token_vault,
            buyer_token_account,
            buyer: buyer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[buy_ix], Some(&buyer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
    svm.send_transaction(tx)
        .expect("buy_neb must succeed in test setup");

    (svm, deployer, pool)
}

fn withdraw_ix(program_id: &Pubkey, pool: Pubkey, authority: Pubkey, amount: u64) -> Instruction {
    let (config, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::WithdrawPoolSol { amount }.data(),
        nebulous_world::accounts::WithdrawPoolSol {
            config,
            pool,
            authority,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_withdraw_pool_sol_moves_lamports_to_the_authority() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, pool) = setup();

    let pool_lamports_before = svm.get_account(&pool).unwrap().lamports;
    let authority_lamports_before = svm.get_account(&deployer.pubkey()).unwrap().lamports;
    let amount = 500_000_000u64; // 0.5 SOL, well under the 2 SOL raised

    let ix = withdraw_ix(&program_id, pool, deployer.pubkey(), amount);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "withdraw_pool_sol failed: {:?}", res);

    let pool_lamports_after = svm.get_account(&pool).unwrap().lamports;
    assert_eq!(pool_lamports_before - pool_lamports_after, amount);

    let authority_lamports_after = svm.get_account(&deployer.pubkey()).unwrap().lamports;
    // Authority received exactly `amount`, minus whatever it paid in tx fees.
    assert!(authority_lamports_after + 100_000 >= authority_lamports_before + amount);
}

#[test]
fn test_withdraw_pool_sol_rejects_non_authority() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, pool) = setup();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let ix = withdraw_ix(&program_id, pool, attacker.pubkey(), 100_000_000);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected withdraw_pool_sol to reject a non-authority caller"
    );
}

#[test]
fn test_withdraw_pool_sol_rejects_amount_exceeding_withdrawable_balance() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, pool) = setup();

    // Only 2 SOL was ever raised — asking for far more than that (and more
    // than the pool's total lamport balance) must fail rather than
    // underflow the account's lamports.
    let ix = withdraw_ix(&program_id, pool, deployer.pubkey(), 100_000_000_000);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected withdraw_pool_sol to reject an amount exceeding the withdrawable balance"
    );
}

#[test]
fn test_withdraw_pool_sol_rejects_leaving_the_pool_below_rent_exemption() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, pool) = setup();

    // The pool holds rent-exempt-minimum + 2 SOL raised; withdrawing exactly
    // the full 2 SOL raised should succeed (leaves exactly the rent-exempt
    // minimum)...
    let ix = withdraw_ix(&program_id, pool, deployer.pubkey(), 2_000_000_000);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "withdrawing exactly the raised amount should succeed: {:?}",
        res
    );

    // ...but trying to withdraw even one more lamport now (which would dip
    // into the rent-exempt reserve) must fail.
    let ix2 = withdraw_ix(&program_id, pool, deployer.pubkey(), 1);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix2], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected withdraw_pool_sol to reject dipping into the rent-exempt reserve"
    );
}
