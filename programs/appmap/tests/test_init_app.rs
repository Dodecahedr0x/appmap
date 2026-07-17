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
    appmap::constants::{
        APP_SEED, CONFIG_SEED, TAGS_REWARD_VAULT_SEED, VOTE_REWARD_VAULT_SEED, VOTE_VAULT_SEED,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, Mint},
};

/// See `test_initialize.rs` for context: overwrites the appmap program's
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

/// Sets up a fresh LiteSVM instance with the appmap program loaded, a funded
/// deployer/payer, and a fake SPL mint account. Then initializes `Config`
/// (seeds = [CONFIG_SEED]) so `init_app` has a singleton to read
/// `vote_mint` from. Returns the SVM, the deployer keypair (the program's
/// upgrade authority), and the vote mint pubkey.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = appmap::id();
    let deployer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/appmap.so");
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
    let initialize_ix = Instruction::new_with_bytes(
        program_id,
        &appmap::instruction::Initialize {
            protocol_fee_bps: 250,
        }
        .data(),
        appmap::accounts::Initialize {
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

    (svm, deployer, vote_mint)
}

struct AppPdas {
    app: Pubkey,
    vote_vault: Pubkey,
    vote_reward_vault: Pubkey,
    tags_reward_vault: Pubkey,
}

fn derive_app_pdas(program_id: &Pubkey, app_id: &str) -> AppPdas {
    let (app, _) = Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], program_id);
    let (vote_vault, _) =
        Pubkey::find_program_address(&[VOTE_VAULT_SEED, app.as_ref()], program_id);
    let (vote_reward_vault, _) =
        Pubkey::find_program_address(&[VOTE_REWARD_VAULT_SEED, app.as_ref()], program_id);
    let (tags_reward_vault, _) =
        Pubkey::find_program_address(&[TAGS_REWARD_VAULT_SEED, app.as_ref()], program_id);
    AppPdas {
        app,
        vote_vault,
        vote_reward_vault,
        tags_reward_vault,
    }
}

fn init_app_ix(
    program_id: &Pubkey,
    config: &Pubkey,
    vote_mint: &Pubkey,
    payer: &Pubkey,
    app_id: &str,
    pdas: &AppPdas,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &appmap::instruction::InitApp {
            app_id: app_id.to_string(),
        }
        .data(),
        appmap::accounts::InitApp {
            app: pdas.app,
            config: *config,
            vote_vault: pdas.vote_vault,
            vote_reward_vault: pdas.vote_reward_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            vote_mint: *vote_mint,
            payer: *payer,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_init_app() {
    let program_id = appmap::id();
    let (mut svm, deployer, vote_mint) = setup();
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    // Registering an app is permissionless: use a payer that is *not* the
    // program's upgrade authority (unlike `initialize`, which requires it),
    // to prove no authority/signer-identity gating crept in.
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    let app_id = "cid_test_app_0000000001".to_string();
    let pdas = derive_app_pdas(&program_id, &app_id);
    let instruction = init_app_ix(
        &program_id,
        &config,
        &vote_mint,
        &stranger.pubkey(),
        &app_id,
        &pdas,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&stranger.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&stranger]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transaction failed: {:?}", res);

    // The `AppAccount` was created with zeroed counters and the right vault
    // pubkeys.
    let app_account_raw = svm.get_account(&pdas.app).expect("app account must exist");
    let app_account: appmap::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut app_account_raw.data.as_slice())
            .unwrap();
    assert_eq!(app_account.app_id, app_id);
    assert_eq!(app_account.vote_vault, pdas.vote_vault);
    assert_eq!(app_account.vote_reward_vault, pdas.vote_reward_vault);
    assert_eq!(app_account.tags_reward_vault, pdas.tags_reward_vault);
    assert_eq!(app_account.total_vote_stake, 0);
    assert_eq!(app_account.vote_acc_reward_per_share, 0);
    assert_eq!(app_account.total_tag_stake, 0);
    assert_eq!(app_account.tags_acc_reward_per_share, 0);

    // All three vaults exist, are owned (as SPL token accounts) by the
    // `app` PDA, and hold the configured vote mint.
    for vault in [
        pdas.vote_vault,
        pdas.vote_reward_vault,
        pdas.tags_reward_vault,
    ] {
        let raw = svm.get_account(&vault).expect("vault account must exist");
        assert_eq!(raw.owner, TOKEN_PROGRAM_ID);
        let token_account = SplTokenAccount::unpack(&raw.data).unwrap();
        assert_eq!(token_account.mint, vote_mint);
        assert_eq!(token_account.owner, pdas.app);
        assert_eq!(token_account.amount, 0);
    }

    let _ = deployer;
}

#[test]
fn test_init_app_rejects_app_id_over_32_bytes() {
    let program_id = appmap::id();
    let (mut svm, _deployer, vote_mint) = setup();
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    // 33 bytes exceeds Solana's 32-byte-per-seed limit. `Pubkey::find_program_address`
    // panics on an oversized seed on *any* target (not just on-chain), so we
    // can't even derive the "real" PDAs for this app_id here — the same way
    // a client can't either (`PublicKey.findProgramAddressSync` throws
    // client-side too, see `tests/appmap.ts`). That's fine: we only need
    // *some* pubkeys in the `app`/vault account slots, because the program's
    // own `find_program_address` call (during account resolution, before the
    // handler body or any other constraint runs — see the comment in
    // `init_app.rs`) panics on the oversized seed regardless of what keys we
    // pass. What we're asserting is that the transaction is rejected either
    // way.
    let app_id = "a".repeat(33);
    let pdas = AppPdas {
        app: Pubkey::new_unique(),
        vote_vault: Pubkey::new_unique(),
        vote_reward_vault: Pubkey::new_unique(),
        tags_reward_vault: Pubkey::new_unique(),
    };
    let instruction = init_app_ix(
        &program_id,
        &config,
        &vote_mint,
        &payer.pubkey(),
        &app_id,
        &pdas,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected init_app to reject an app_id longer than 32 bytes, but it succeeded"
    );
}
