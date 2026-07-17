use {
    anchor_lang::solana_program::{
        bpf_loader_upgradeable::{self, UpgradeableLoaderState},
        program_option::COption,
        program_pack::Pack,
        pubkey::Pubkey,
        system_program,
    },
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    anchor_spl::associated_token::{get_associated_token_address, ID as ASSOCIATED_TOKEN_PROGRAM_ID},
    anchor_spl::token::ID as TOKEN_PROGRAM_ID,
    nebulous_world::constants::{APP_SEED, CONFIG_SEED},
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::Mint,
};

/// See `test_initialize.rs` for context: overwrites the nebulous_world program's
/// `ProgramData` account so `upgrade_authority` is its recorded upgrade
/// authority, which is required to call `initialize` (but *not* `init_app`,
/// which is permissionless).
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

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, a funded
/// deployer/payer, and a fake SPL mint account. Then initializes `Config`
/// (seeds = [CONFIG_SEED]) and the single global vault so `init_app` has a
/// singleton to read `vote_mint` from. Returns the SVM, the deployer keypair
/// (the program's upgrade authority), and the vote mint pubkey.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = nebulous_world::id();
    let deployer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/nebulous_world.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&deployer.pubkey(), 1_000_000_000).unwrap();

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
    let vault = get_associated_token_address(&config, &vote_mint);
    let initialize_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::Initialize {
            protocol_fee_bps: 250,
        }
        .data(),
        nebulous_world::accounts::Initialize {
            config,
            vault,
            authority: deployer.pubkey(),
            vote_mint,
            program: program_id,
            program_data,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[initialize_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("initialize must succeed in test setup");

    (svm, deployer, vote_mint)
}

fn init_app_ix(program_id: &Pubkey, payer: &Pubkey, app_id: &str, app: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.to_string(),
        }
        .data(),
        nebulous_world::accounts::InitApp {
            app: *app,
            payer: *payer,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_init_app() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, _vote_mint) = setup();

    // Registering an app is permissionless: use a payer that is *not* the
    // program's upgrade authority (unlike `initialize`, which requires it),
    // to prove no authority/signer-identity gating crept in.
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    let app_id = "cid_test_app_0000000001".to_string();
    let (app, _bump) = Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], &program_id);
    let instruction = init_app_ix(&program_id, &stranger.pubkey(), &app_id, &app);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&stranger.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&stranger]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transaction failed: {:?}", res);

    // The `AppAccount` was created with zeroed counters and no vault
    // pubkeys of its own — every app shares the single global vault.
    let app_account_raw = svm.get_account(&app).expect("app account must exist");
    let app_account: nebulous_world::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut app_account_raw.data.as_slice())
            .unwrap();
    assert_eq!(app_account.app_id, app_id);
    assert_eq!(app_account.total_vote_stake, 0);
    assert_eq!(app_account.vote_acc_reward_per_share, 0);
    assert_eq!(app_account.total_tag_stake, 0);
    assert_eq!(app_account.tags_acc_reward_per_share, 0);

    let _ = deployer;
}

#[test]
fn test_init_app_rejects_app_id_over_32_bytes() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, _vote_mint) = setup();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    // 33 bytes exceeds Solana's 32-byte-per-seed limit. `Pubkey::find_program_address`
    // panics on an oversized seed on *any* target (not just on-chain), so we
    // can't even derive the "real" `app` PDA for this app_id here — the same
    // way a client can't either (`PublicKey.findProgramAddressSync` throws
    // client-side too, see `tests/nebulous_world.ts`). That's fine: we only
    // need *some* pubkey in the `app` slot, because the program's own
    // `find_program_address` call (during account resolution, before the
    // handler body or any other constraint runs — see the comment in
    // `init_app.rs`) panics on the oversized seed regardless of what key we
    // pass. What we're asserting is that the transaction is rejected either
    // way.
    let app_id = "a".repeat(33);
    let app = Pubkey::new_unique();
    let instruction = init_app_ix(&program_id, &payer.pubkey(), &app_id, &app);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected init_app to reject an app_id longer than 32 bytes, but it succeeded"
    );
}
