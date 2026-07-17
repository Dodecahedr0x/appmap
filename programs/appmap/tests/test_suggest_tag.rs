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
        APP_SEED, CONFIG_SEED, TAGS_REWARD_VAULT_SEED, TAG_SEED, TAG_VAULT_SEED,
        VOTE_REWARD_VAULT_SEED, VOTE_VAULT_SEED,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, Mint},
};

/// See `test_init_app.rs` for context: overwrites the appmap program's
/// `ProgramData` account so `upgrade_authority` is its recorded upgrade
/// authority, which is required to call `initialize`.
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

/// Bundles the handful of pubkeys every helper in this file needs (the
/// program id, the `Config` PDA, and the configured vote mint), so helper
/// functions take one `&Env` instead of three separate `&Pubkey` params.
struct Env {
    program_id: Pubkey,
    config: Pubkey,
    vote_mint: Pubkey,
}

/// Sets up a fresh LiteSVM instance with the appmap program loaded, a funded
/// deployer/payer, and a fake SPL mint account, then initializes `Config`.
fn setup() -> (LiteSVM, Keypair, Env) {
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

    (
        svm,
        deployer,
        Env {
            program_id,
            config,
            vote_mint,
        },
    )
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

fn init_app_ix(env: &Env, payer: &Pubkey, app_id: &str, pdas: &AppPdas) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &appmap::instruction::InitApp {
            app_id: app_id.to_string(),
        }
        .data(),
        appmap::accounts::InitApp {
            app: pdas.app,
            config: env.config,
            vote_vault: pdas.vote_vault,
            vote_reward_vault: pdas.vote_reward_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            vote_mint: env.vote_mint,
            payer: *payer,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

struct TagPdas {
    app_tag: Pubkey,
    principal_vault: Pubkey,
}

fn derive_tag_pdas(program_id: &Pubkey, app: &Pubkey, tag_id: &str) -> TagPdas {
    let (app_tag, _) =
        Pubkey::find_program_address(&[TAG_SEED, app.as_ref(), tag_id.as_bytes()], program_id);
    let (principal_vault, _) =
        Pubkey::find_program_address(&[TAG_VAULT_SEED, app_tag.as_ref()], program_id);
    TagPdas {
        app_tag,
        principal_vault,
    }
}

fn suggest_tag_ix(
    env: &Env,
    payer: &Pubkey,
    app: &Pubkey,
    app_id: &str,
    tag_id: &str,
    tag_pdas: &TagPdas,
) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &appmap::instruction::SuggestTag {
            app_id: app_id.to_string(),
            tag_id: tag_id.to_string(),
        }
        .data(),
        appmap::accounts::SuggestTag {
            app: *app,
            app_tag: tag_pdas.app_tag,
            config: env.config,
            principal_vault: tag_pdas.principal_vault,
            vote_mint: env.vote_mint,
            payer: *payer,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// `FailedTransactionMetadata` is a large struct (>=200 bytes); box it so this
// `Result`'s error variant doesn't bloat every caller's stack frame
// (clippy::result_large_err).
fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ix: Instruction,
) -> Result<(), Box<litesvm::types::FailedTransactionMetadata>> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(Box::new)
}

fn register_app(svm: &mut LiteSVM, env: &Env, payer: &Keypair, app_id: &str) -> AppPdas {
    let pdas = derive_app_pdas(&env.program_id, app_id);
    let ix = init_app_ix(env, &payer.pubkey(), app_id, &pdas);
    send(svm, payer, ix).expect("init_app must succeed in test setup");
    pdas
}

#[test]
fn test_suggest_tag_happy_path() {
    let (mut svm, deployer, env) = setup();

    let app_id = "cid_test_app_0000000001".to_string();
    let app_pdas = register_app(&mut svm, &env, &deployer, &app_id);

    let tag_id = "defi".to_string();
    let tag_pdas = derive_tag_pdas(&env.program_id, &app_pdas.app, &tag_id);
    let ix = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas.app,
        &app_id,
        &tag_id,
        &tag_pdas,
    );
    let res = send(&mut svm, &deployer, ix);
    assert!(res.is_ok(), "suggest_tag failed: {:?}", res);

    let raw = svm
        .get_account(&tag_pdas.app_tag)
        .expect("app_tag account must exist");
    let app_tag: appmap::AppTagAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap();
    assert_eq!(app_tag.app, app_pdas.app);
    assert_eq!(app_tag.tag_id, tag_id);
    assert_eq!(app_tag.principal_vault, tag_pdas.principal_vault);
    assert_eq!(app_tag.stake_amount, 0);

    let vault_raw = svm
        .get_account(&tag_pdas.principal_vault)
        .expect("principal_vault must exist");
    assert_eq!(vault_raw.owner, TOKEN_PROGRAM_ID);
    let token_account = SplTokenAccount::unpack(&vault_raw.data).unwrap();
    assert_eq!(token_account.mint, env.vote_mint);
    assert_eq!(token_account.owner, tag_pdas.app_tag);
    assert_eq!(token_account.amount, 0);
}

#[test]
fn test_suggest_tag_is_permissionless() {
    let (mut svm, deployer, env) = setup();

    let app_id = "cid_test_app_0000000002".to_string();
    let app_pdas = register_app(&mut svm, &env, &deployer, &app_id);

    // A stranger (not the deployer/upgrade authority) can suggest a tag.
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    let tag_id = "gaming".to_string();
    let tag_pdas = derive_tag_pdas(&env.program_id, &app_pdas.app, &tag_id);
    let ix = suggest_tag_ix(
        &env,
        &stranger.pubkey(),
        &app_pdas.app,
        &app_id,
        &tag_id,
        &tag_pdas,
    );
    let res = send(&mut svm, &stranger, ix);
    assert!(
        res.is_ok(),
        "suggest_tag failed for a stranger payer: {:?}",
        res
    );
}

#[test]
fn test_suggest_tag_rejects_duplicate_tag_for_same_app() {
    let (mut svm, deployer, env) = setup();

    let app_id = "cid_test_app_0000000003".to_string();
    let app_pdas = register_app(&mut svm, &env, &deployer, &app_id);

    let tag_id = "defi".to_string();
    let tag_pdas = derive_tag_pdas(&env.program_id, &app_pdas.app, &tag_id);
    let ix1 = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas.app,
        &app_id,
        &tag_id,
        &tag_pdas,
    );
    send(&mut svm, &deployer, ix1).expect("first suggest_tag must succeed");

    // Suggesting the exact same (app, tag_id) pair again must fail cleanly —
    // Anchor's `init` constraint on `app_tag` requires the account not
    // already exist.
    let ix2 = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas.app,
        &app_id,
        &tag_id,
        &tag_pdas,
    );
    let res = send(&mut svm, &deployer, ix2);
    assert!(
        res.is_err(),
        "expected a duplicate suggest_tag for the same (app, tag_id) to fail"
    );
}

#[test]
fn test_suggest_tag_rejects_tag_id_over_32_bytes() {
    let (mut svm, deployer, env) = setup();

    let app_id = "cid_test_app_0000000004".to_string();
    let app_pdas = register_app(&mut svm, &env, &deployer, &app_id);

    // 33 bytes exceeds Solana's 32-byte-per-seed limit — mirrors
    // `test_init_app.rs`'s oversized app_id test. We can't derive the "real"
    // PDAs (find_program_address panics client-side too), so pass unrelated
    // pubkeys in those slots; the program's own seed derivation during
    // account resolution panics on the oversized seed regardless.
    let tag_id = "a".repeat(33);
    let tag_pdas = TagPdas {
        app_tag: Pubkey::new_unique(),
        principal_vault: Pubkey::new_unique(),
    };
    let ix = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas.app,
        &app_id,
        &tag_id,
        &tag_pdas,
    );
    let res = send(&mut svm, &deployer, ix);
    assert!(
        res.is_err(),
        "expected suggest_tag to reject a tag_id longer than 32 bytes"
    );
}

#[test]
fn test_suggest_tag_same_tag_id_different_apps_no_collision() {
    let (mut svm, deployer, env) = setup();

    let app_id_a = "cid_test_app_aaaaaaaaaaa".to_string();
    let app_id_b = "cid_test_app_bbbbbbbbbbb".to_string();
    let app_pdas_a = register_app(&mut svm, &env, &deployer, &app_id_a);
    let app_pdas_b = register_app(&mut svm, &env, &deployer, &app_id_b);
    assert_ne!(app_pdas_a.app, app_pdas_b.app);

    // The SAME tag_id string suggested for two DIFFERENT apps must not
    // collide, since the `app_tag` PDA's seeds include `app.key()`.
    let tag_id = "defi".to_string();
    let tag_pdas_a = derive_tag_pdas(&env.program_id, &app_pdas_a.app, &tag_id);
    let tag_pdas_b = derive_tag_pdas(&env.program_id, &app_pdas_b.app, &tag_id);
    assert_ne!(tag_pdas_a.app_tag, tag_pdas_b.app_tag);

    let ix_a = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas_a.app,
        &app_id_a,
        &tag_id,
        &tag_pdas_a,
    );
    let res_a = send(&mut svm, &deployer, ix_a);
    assert!(res_a.is_ok(), "suggest_tag for app A failed: {:?}", res_a);

    let ix_b = suggest_tag_ix(
        &env,
        &deployer.pubkey(),
        &app_pdas_b.app,
        &app_id_b,
        &tag_id,
        &tag_pdas_b,
    );
    let res_b = send(&mut svm, &deployer, ix_b);
    assert!(res_b.is_ok(), "suggest_tag for app B failed: {:?}", res_b);

    let raw_a = svm.get_account(&tag_pdas_a.app_tag).unwrap();
    let app_tag_a: appmap::AppTagAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw_a.data.as_slice()).unwrap();
    let raw_b = svm.get_account(&tag_pdas_b.app_tag).unwrap();
    let app_tag_b: appmap::AppTagAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw_b.data.as_slice()).unwrap();

    assert_eq!(app_tag_a.app, app_pdas_a.app);
    assert_eq!(app_tag_b.app, app_pdas_b.app);
    assert_eq!(app_tag_a.tag_id, tag_id);
    assert_eq!(app_tag_b.tag_id, tag_id);
    assert_ne!(app_tag_a.principal_vault, app_tag_b.principal_vault);
}
