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
    nebulous_world::constants::{
        APP_SEED, APP_TAG_STAKE_SEED, CONFIG_SEED, STAKE_POSITION_SEED, TAG_SEED,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint},
};

/// See `test_initialize.rs` for context: overwrites the nebulous_world program's
/// `ProgramData` account so `upgrade_authority` is its recorded upgrade
/// authority, which is required to call `initialize`.
fn set_upgrade_authority(svm: &mut LiteSVM, program_id: &Pubkey, upgrade_authority: Pubkey) -> Pubkey {
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

struct Env {
    program_id: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    vote_mint: Pubkey,
}

struct TagPdas {
    tag: Pubkey,
    app_tag_stake: Pubkey,
}

fn derive_app(program_id: &Pubkey, app_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], program_id).0
}

fn derive_tag_pdas(program_id: &Pubkey, app: &Pubkey, tag_id: &str) -> TagPdas {
    let (tag, _) = Pubkey::find_program_address(&[TAG_SEED, tag_id.as_bytes()], program_id);
    let (app_tag_stake, _) = Pubkey::find_program_address(
        &[APP_TAG_STAKE_SEED, app.as_ref(), tag.as_ref()],
        program_id,
    );
    TagPdas { tag, app_tag_stake }
}

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, `Config`
/// and the single global vault initialized, one `AppAccount` registered, and
/// one tag suggested (creating both the global `Tag` and its `AppTagStake`).
/// Mirrors `test_withdraw_tag_stake.rs`'s `setup()`.
fn setup() -> (LiteSVM, Keypair, Env, Pubkey, TagPdas) {
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

    let app_id = "cid_closestake_test_app01".to_string();
    let app = derive_app(&program_id, &app_id);
    let init_app_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.clone(),
            url: "example.com".to_string(),
        }
        .data(),
        nebulous_world::accounts::InitApp {
            app,
            payer: deployer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_app_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("init_app must succeed in test setup");

    let tag_id = "defi".to_string();
    let tag_pdas = derive_tag_pdas(&program_id, &app, &tag_id);
    let suggest_tag_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: app_id.clone(),
            tag_id: tag_id.clone(),
        }
        .data(),
        nebulous_world::accounts::SuggestTag {
            app,
            tag: tag_pdas.tag,
            app_tag_stake: tag_pdas.app_tag_stake,
            payer: deployer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[suggest_tag_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("suggest_tag must succeed in test setup");

    (
        svm,
        deployer,
        Env {
            program_id,
            config,
            vault,
            vote_mint,
        },
        app,
        tag_pdas,
    )
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

fn stake_tag_ix(
    env: &Env,
    app: &Pubkey,
    tag_pdas: &TagPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::StakeTag { amount }.data(),
        nebulous_world::accounts::StakeTag {
            app: *app,
            app_tag_stake: tag_pdas.app_tag_stake,
            position: *position,
            config: env.config,
            vault: env.vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw_tag_stake_ix(
    env: &Env,
    app: &Pubkey,
    tag_pdas: &TagPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::WithdrawTagStake { amount }.data(),
        nebulous_world::accounts::WithdrawTagStake {
            app: *app,
            app_tag_stake: tag_pdas.app_tag_stake,
            position: *position,
            config: env.config,
            vault: env.vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn close_tag_stake_position_ix(
    program_id: &Pubkey,
    position: &Pubkey,
    payer: &Pubkey,
    user: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::CloseTagStakePosition {}.data(),
        nebulous_world::accounts::CloseTagStakePosition {
            position: *position,
            payer: *payer,
            user: *user,
        }
        .to_account_metas(None),
    )
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Pubkey, signers: &[&Keypair]) -> bool {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn fetch_position(svm: &LiteSVM, position: Pubkey) -> nebulous_world::StakePosition {
    let raw = svm
        .get_account(&position)
        .expect("position account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

/// Common fixture: registers an app + tag, funds a fresh user's wallet, and
/// stakes `initial_stake` in to create a `StakePosition` — the user is both
/// the position's owner and (via `StakeTag`'s `payer = user`) its rent
/// payer, exactly as every real position is created today.
fn setup_with_position(
    initial_stake: u64,
    wallet_amount: u64,
) -> (LiteSVM, Env, Pubkey, TagPdas, Keypair, Pubkey, Pubkey) {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, user_token_account, env.vote_mint, user.pubkey(), wallet_amount);

    let (position, _bump) = Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, tag_pdas.app_tag_stake.as_ref(), user.pubkey().as_ref()],
        &env.program_id,
    );

    let ix = stake_tag_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), initial_stake);
    assert!(send(&mut svm, ix, &user.pubkey(), &[&user]), "initial stake_tag must succeed in test setup");

    (svm, env, app, tag_pdas, user, user_token_account, position)
}

/// The core happy path: once a tag-stake position is fully withdrawn, its
/// owner can close it and reclaim the rent SOL, refunded to
/// `position.payer` — here, the same wallet that created it.
#[test]
fn test_close_tag_stake_position_reclaims_rent_for_payer() {
    let initial_stake = 4_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, 10_000);

    let withdraw_ix =
        withdraw_tag_stake_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), initial_stake);
    assert!(send(&mut svm, withdraw_ix, &user.pubkey(), &[&user]), "withdraw_tag_stake must succeed");
    assert_eq!(fetch_position(&svm, position).amount, 0);

    let position_rent = svm.get_account(&position).unwrap().lamports;
    let payer_balance_before = svm.get_account(&user.pubkey()).unwrap().lamports;

    let close_ix = close_tag_stake_position_ix(&env.program_id, &position, &user.pubkey(), &user.pubkey());
    assert!(send(&mut svm, close_ix, &user.pubkey(), &[&user]), "close_tag_stake_position transaction failed");

    assert!(
        svm.get_account(&position).map(|a| a.lamports).unwrap_or(0) == 0,
        "closed position account should hold no lamports"
    );
    let payer_balance_after = svm.get_account(&user.pubkey()).unwrap().lamports;
    assert!(
        payer_balance_after + 5_000 >= payer_balance_before + position_rent,
        "expected the reclaimed rent ({position_rent}) to reach the payer net of tx fees: before={payer_balance_before}, after={payer_balance_after}"
    );
}

/// Proves the rent genuinely follows `position.payer`, not just "whoever
/// happens to be both owner and payer" — mirrors
/// `test_close_vote_position_refunds_a_third_party_payer_account`.
#[test]
fn test_close_tag_stake_position_refunds_a_third_party_payer_account() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, env, _app, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();

    let (position, bump) = Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, tag_pdas.app_tag_stake.as_ref(), user.pubkey().as_ref()],
        &program_id,
    );

    let third_party_payer = Pubkey::new_unique();
    svm.airdrop(&third_party_payer, 1).unwrap();

    let rent = svm.minimum_balance_for_rent_exemption(8 + nebulous_world::StakePosition::SPACE);
    let mut stake_position = nebulous_world::StakePosition {
        app_tag_stake: tag_pdas.app_tag_stake,
        owner: user.pubkey(),
        payer: third_party_payer,
        amount: 0,
        reward_debt: 0,
        staked_at: 0,
        bump,
    };
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&mut stake_position, &mut data).unwrap();
    svm.set_account(
        position,
        Account {
            lamports: rent,
            data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let third_party_balance_before = svm.get_account(&third_party_payer).unwrap().lamports;

    let close_ix = close_tag_stake_position_ix(&env.program_id, &position, &third_party_payer, &user.pubkey());
    assert!(send(&mut svm, close_ix, &user.pubkey(), &[&user]), "close_tag_stake_position transaction failed");

    let third_party_balance_after = svm.get_account(&third_party_payer).unwrap().lamports;
    assert_eq!(
        third_party_balance_after,
        third_party_balance_before + rent,
        "the third-party payer, not the signer `user`, must receive the full rent refund"
    );
}

#[test]
fn test_close_tag_stake_position_rejects_nonzero_stake() {
    let initial_stake = 4_000u64;
    let (mut svm, env, _app, _tag_pdas, user, _user_token_account, position) =
        setup_with_position(initial_stake, 10_000);

    let close_ix = close_tag_stake_position_ix(&env.program_id, &position, &user.pubkey(), &user.pubkey());
    let ok = send(&mut svm, close_ix, &user.pubkey(), &[&user]);
    assert!(!ok, "expected close_tag_stake_position to reject a position that still holds stake");
    assert_eq!(fetch_position(&svm, position).amount, initial_stake);
}

#[test]
fn test_close_tag_stake_position_rejects_wrong_payer_account() {
    let initial_stake = 4_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, 10_000);

    let withdraw_ix =
        withdraw_tag_stake_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), initial_stake);
    assert!(send(&mut svm, withdraw_ix, &user.pubkey(), &[&user]), "withdraw_tag_stake must succeed");

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let close_ix = close_tag_stake_position_ix(&env.program_id, &position, &attacker.pubkey(), &user.pubkey());
    let ok = send(&mut svm, close_ix, &user.pubkey(), &[&user]);
    assert!(!ok, "expected close_tag_stake_position to reject a payer account that isn't position.payer");
    assert_eq!(fetch_position(&svm, position).amount, 0);
}

#[test]
fn test_close_tag_stake_position_rejects_non_owner_signer() {
    let initial_stake = 4_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, 10_000);

    let withdraw_ix =
        withdraw_tag_stake_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), initial_stake);
    assert!(send(&mut svm, withdraw_ix, &user.pubkey(), &[&user]), "withdraw_tag_stake must succeed");

    let not_the_owner = Keypair::new();
    svm.airdrop(&not_the_owner.pubkey(), 1_000_000_000).unwrap();

    let close_ix = close_tag_stake_position_ix(&env.program_id, &position, &user.pubkey(), &not_the_owner.pubkey());
    let ok = send(&mut svm, close_ix, &not_the_owner.pubkey(), &[&not_the_owner]);
    assert!(!ok, "expected close_tag_stake_position to reject a signer who isn't the position's owner");
}
