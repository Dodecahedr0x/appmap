use {
    anchor_lang::solana_program::{
        bpf_loader_upgradeable::{self, UpgradeableLoaderState},
        program_option::COption,
        program_pack::Pack,
        pubkey::Pubkey,
        system_program,
    },
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    appmap::constants::CONFIG_SEED,
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::Mint,
};

/// Overwrites the appmap program's `ProgramData` account (created by
/// `svm.add_program`, which defaults to `upgrade_authority_address: None`) so
/// that `upgrade_authority` is its recorded upgrade authority. Returns the
/// programdata account's address.
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

/// Sets up a fresh LiteSVM instance with the appmap program loaded, a funded
/// payer, and a fake SPL mint account (so it satisfies `Account<'info, Mint>`
/// deserialization). Returns the SVM, the payer, and the mint pubkey.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = appmap::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/appmap.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let vote_mint = Pubkey::new_unique();
    let mint = Mint {
        mint_authority: COption::Some(payer.pubkey()),
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

    (svm, payer, vote_mint)
}

fn initialize_ix(
    program_id: &Pubkey,
    authority: &Pubkey,
    vote_mint: &Pubkey,
    program_data: &Pubkey,
    protocol_fee_bps: u16,
) -> Instruction {
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    Instruction::new_with_bytes(
        *program_id,
        &appmap::instruction::Initialize { protocol_fee_bps }.data(),
        appmap::accounts::Initialize {
            config,
            authority: *authority,
            vote_mint: *vote_mint,
            program: *program_id,
            program_data: *program_data,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_initialize() {
    let program_id = appmap::id();
    let (mut svm, payer, vote_mint) = setup();
    let program_data = set_upgrade_authority(&mut svm, &program_id, payer.pubkey());

    let instruction = initialize_ix(&program_id, &payer.pubkey(), &vote_mint, &program_data, 250);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transaction failed: {:?}", res);
}

#[test]
fn test_initialize_rejects_fee_above_10_000_bps() {
    let program_id = appmap::id();
    let (mut svm, payer, vote_mint) = setup();
    let program_data = set_upgrade_authority(&mut svm, &program_id, payer.pubkey());

    let instruction = initialize_ix(
        &program_id,
        &payer.pubkey(),
        &vote_mint,
        &program_data,
        10_001,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected initialize to reject a fee > 10_000 bps, but it succeeded"
    );
}

#[test]
fn test_initialize_rejects_non_upgrade_authority_signer() {
    let program_id = appmap::id();
    let (mut svm, payer, vote_mint) = setup();
    // Leave the program's upgrade authority as some other, unrelated key —
    // `payer` (who signs the `initialize` call below) is NOT that authority.
    let real_upgrade_authority = Pubkey::new_unique();
    let program_data = set_upgrade_authority(&mut svm, &program_id, real_upgrade_authority);

    let instruction = initialize_ix(&program_id, &payer.pubkey(), &vote_mint, &program_data, 250);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected initialize to reject a signer that is not the program's upgrade authority, but it succeeded"
    );
}
