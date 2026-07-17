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
    nebulous_world::constants::{
        APP_SEED, CONFIG_SEED, REWARD_PRECISION, STAKE_POSITION_SEED, TAGS_REWARD_VAULT_SEED,
        TAG_SEED, TAG_VAULT_SEED, VOTE_REWARD_VAULT_SEED, VOTE_VAULT_SEED,
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

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, `Config`
/// initialized, a single `AppAccount` (with its three vaults) registered via
/// `init_app`, and one tag suggested via `suggest_tag`. Returns the SVM, the
/// deployer keypair, the vote mint, the app's PDAs, and the tag's PDAs.
fn setup() -> (LiteSVM, Keypair, Pubkey, AppPdas, TagPdas) {
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

    let app_id = "cid_stake_test_app_000001".to_string();
    let pdas = derive_app_pdas(&program_id, &app_id);
    let init_app_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.clone(),
        }
        .data(),
        nebulous_world::accounts::InitApp {
            app: pdas.app,
            config,
            vote_vault: pdas.vote_vault,
            vote_reward_vault: pdas.vote_reward_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            vote_mint,
            payer: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
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
    let tag_pdas = derive_tag_pdas(&program_id, &pdas.app, &tag_id);
    let suggest_tag_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: app_id.clone(),
            tag_id: tag_id.clone(),
        }
        .data(),
        nebulous_world::accounts::SuggestTag {
            app: pdas.app,
            app_tag: tag_pdas.app_tag,
            config,
            principal_vault: tag_pdas.principal_vault,
            vote_mint,
            payer: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[suggest_tag_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("suggest_tag must succeed in test setup");

    (svm, deployer, vote_mint, pdas, tag_pdas)
}

/// Registers an ADDITIONAL app + tag pair (distinct from `setup()`'s), using
/// the same already-initialized `Config`/`vote_mint`/`deployer`. Used by the
/// cross-app mismatch regression test below, which needs two independent
/// (app, app_tag) pairs to construct a mismatched instruction call.
fn register_second_app_and_tag(
    svm: &mut LiteSVM,
    deployer: &Keypair,
    vote_mint: Pubkey,
    app_id: &str,
    tag_id: &str,
) -> (AppPdas, TagPdas) {
    let program_id = nebulous_world::id();
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    let pdas = derive_app_pdas(&program_id, app_id);
    let init_app_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.to_string(),
        }
        .data(),
        nebulous_world::accounts::InitApp {
            app: pdas.app,
            config,
            vote_vault: pdas.vote_vault,
            vote_reward_vault: pdas.vote_reward_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            vote_mint,
            payer: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_app_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("init_app (second app) must succeed in test setup");

    let tag_pdas = derive_tag_pdas(&program_id, &pdas.app, tag_id);
    let suggest_tag_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: app_id.to_string(),
            tag_id: tag_id.to_string(),
        }
        .data(),
        nebulous_world::accounts::SuggestTag {
            app: pdas.app,
            app_tag: tag_pdas.app_tag,
            config,
            principal_vault: tag_pdas.principal_vault,
            vote_mint,
            payer: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[suggest_tag_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("suggest_tag (second app) must succeed in test setup");

    (pdas, tag_pdas)
}

/// Directly writes a funded, initialized SPL token account owned by `owner`
/// for `mint`, holding `amount` tokens — bypassing the token program's
/// `InitializeAccount`/`MintTo` instructions since we only need the end
/// state, mirroring how `setup()` above fabricates the mint account.
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

/// Directly overwrites an already-created `AppAccount`'s
/// `tags_acc_reward_per_share`, so tests can exercise the reward-payout leg
/// of `stake_tag()` (normally only nonzero once `fund_app_rewards` funds the
/// Tags pool) without needing that instruction here. Deserializes the
/// account's current data, mutates the one field, and re-serializes it
/// (preserving the Anchor discriminator via `AccountSerialize`) back over the
/// same account, keeping its existing lamports/owner.
fn set_app_tags_accumulator(svm: &mut LiteSVM, app: Pubkey, acc_reward_per_share: u128) {
    let mut raw = svm.get_account(&app).expect("app account must exist");
    let mut app_account: nebulous_world::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap();
    app_account.tags_acc_reward_per_share = acc_reward_per_share;

    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&app_account, &mut data).unwrap();
    raw.data = data;
    svm.set_account(app, raw).unwrap();
}

fn stake_tag_ix(
    program_id: &Pubkey,
    pdas: &AppPdas,
    tag_pdas: &TagPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::StakeTag { amount }.data(),
        nebulous_world::accounts::StakeTag {
            app: pdas.app,
            app_tag: tag_pdas.app_tag,
            position: *position,
            principal_vault: tag_pdas.principal_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn fetch_position(svm: &LiteSVM, position: Pubkey) -> nebulous_world::StakePosition {
    let raw = svm
        .get_account(&position)
        .expect("position account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn fetch_app(svm: &LiteSVM, app: Pubkey) -> nebulous_world::AppAccount {
    let raw = svm.get_account(&app).expect("app account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn fetch_app_tag(svm: &LiteSVM, app_tag: Pubkey) -> nebulous_world::AppTagAccount {
    let raw = svm
        .get_account(&app_tag)
        .expect("app_tag account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn fetch_token_amount(svm: &LiteSVM, pubkey: Pubkey) -> u64 {
    let raw = svm.get_account(&pubkey).expect("token account must exist");
    SplTokenAccount::unpack(&raw.data).unwrap().amount
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Pubkey, signers: &[&Keypair]) -> bool {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

#[test]
fn test_stake_tag_locks_principal_and_creates_position() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        10_000,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let amount = 4_000u64;
    let ix = stake_tag_ix(
        &program_id,
        &pdas,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        amount,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "stake_tag transaction failed"
    );

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.owner, user.pubkey());
    assert_eq!(position_account.amount, amount);
    assert_eq!(position_account.reward_debt, 0);

    // Both counters moved in lockstep.
    let app_tag_account = fetch_app_tag(&svm, tag_pdas.app_tag);
    assert_eq!(app_tag_account.stake_amount, amount);
    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_tag_stake, amount);

    assert_eq!(fetch_token_amount(&svm, tag_pdas.principal_vault), amount);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - amount
    );
}

#[test]
fn test_stake_tag_rejects_zero_amount() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        10_000,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let ix = stake_tag_ix(
        &program_id,
        &pdas,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        0,
    );
    assert!(
        !send(&mut svm, ix, &user.pubkey(), &[&user]),
        "expected stake_tag to reject a zero amount, but it succeeded"
    );
}

#[test]
fn test_stake_tag_accumulates_across_two_deposits() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        10_000,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    for amount in [1_000u64, 2_500u64] {
        let ix = stake_tag_ix(
            &program_id,
            &pdas,
            &tag_pdas,
            &position,
            &user_token_account,
            &user.pubkey(),
            amount,
        );
        assert!(
            send(&mut svm, ix, &user.pubkey(), &[&user]),
            "stake_tag transaction failed"
        );
    }

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, 3_500);

    let app_tag_account = fetch_app_tag(&svm, tag_pdas.app_tag);
    assert_eq!(app_tag_account.stake_amount, 3_500);
    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_tag_stake, 3_500);
}

/// Exercises the reward-payout CPI leg of `stake_tag()` end-to-end — the
/// highest-risk path (the `app` PDA, NOT the `app_tag` PDA, signing a
/// transfer out of the SHARED `tags_reward_vault`), which every other test
/// above never touches since they all run with `tags_acc_reward_per_share ==
/// 0`. This test stakes once to create a nonzero position, manually bumps
/// the app's tags accumulator (standing in for `fund_app_rewards` targeting
/// the Tags pool) and pre-funds `tags_reward_vault`, then stakes again and
/// asserts the pending reward actually lands in the user's wallet and the
/// position's `reward_debt` checkpoints to the new accumulator value.
#[test]
fn test_stake_tag_pays_out_pending_reward_on_second_stake() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        10_000,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let first_amount = 1_000u64;
    let first_ix = stake_tag_ix(
        &program_id,
        &pdas,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        first_amount,
    );
    assert!(
        send(&mut svm, first_ix, &user.pubkey(), &[&user]),
        "first stake_tag must succeed in test setup"
    );

    // Stand in for `fund_app_rewards` (Tags pool): bump the shared
    // accumulator to 1 reward token per staked token, and pre-fund the
    // SHARED reward vault so the payout CPI has something to transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_tags_accumulator(&mut svm, pdas.app, acc_reward_per_share);
    fund_token_account(
        &mut svm,
        pdas.tags_reward_vault,
        vote_mint,
        pdas.app,
        50_000,
    );

    // settle_pending(1_000, reward_debt=0, acc=1*PRECISION) = 1_000.
    let expected_pending = 1_000u64;

    let second_amount = 500u64;
    let second_ix = stake_tag_ix(
        &program_id,
        &pdas,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        second_amount,
    );
    assert!(
        send(&mut svm, second_ix, &user.pubkey(), &[&user]),
        "second stake_tag transaction failed"
    );

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, first_amount + second_amount);
    // reward_debt_for(1_500, 1*PRECISION) = 1_500.
    assert_eq!(position_account.reward_debt, 1_500);

    let app_tag_account = fetch_app_tag(&svm, tag_pdas.app_tag);
    assert_eq!(app_tag_account.stake_amount, first_amount + second_amount);
    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_tag_stake, first_amount + second_amount);

    // The reward actually landed in the user's wallet, signed by the `app`
    // PDA (not `app_tag`) — started with 10_000, paid principal deposits,
    // received `expected_pending` back as reward.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - first_amount - second_amount + expected_pending
    );

    // The shared reward vault paid out exactly `expected_pending`.
    assert_eq!(
        fetch_token_amount(&svm, pdas.tags_reward_vault),
        50_000 - expected_pending
    );

    // The tag's own principal vault holds both deposits, untouched by the
    // reward leg.
    assert_eq!(
        fetch_token_amount(&svm, tag_pdas.principal_vault),
        first_amount + second_amount
    );
}

/// Regression test for a critical fund-drain vulnerability: without the
/// `constraint = app_tag.app == app.key()` check on `StakeTag::app_tag`,
/// each of `app`/`app_tag`'s seeds/bump constraints only proves internal
/// self-consistency — NEITHER proves the two accounts belong together. An
/// attacker could permissionlessly create their OWN (app, app_tag) pair via
/// `init_app`/`suggest_tag`, then call `stake_tag` passing THEIR `app_tag`
/// alongside a victim's well-funded `app`: `principal_vault` would still
/// address-check against the attacker's own vault (their principal stays
/// safe/recoverable), but `tags_reward_vault` would address-check against
/// the VICTIM's real vault, silently crediting the attacker's position
/// against the victim's `total_tag_stake`/`tags_acc_reward_per_share` — a
/// permissionless, capital-light path to draining every app's real reward
/// vault once its accumulator advances from legitimate funding.
///
/// This test builds exactly that mismatched pair (a second, independent
/// app+tag standing in for the "attacker's own") and asserts `stake_tag`
/// rejects it with `TagAppMismatch`, not merely "some error".
#[test]
fn test_stake_tag_rejects_mismatched_app_and_app_tag() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint, victim_pdas, _victim_tag_pdas) = setup();

    // The attacker's own, entirely independent app + tag.
    let (_attacker_pdas, attacker_tag_pdas) = register_second_app_and_tag(
        &mut svm,
        &deployer,
        vote_mint,
        "cid_attacker_app_0000001",
        "attacker_tag",
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        10_000,
    );

    // Position PDA derived off the ATTACKER's app_tag (matching what
    // `stake_tag`'s own `position` seeds constraint expects for this
    // `app_tag`), but the instruction passes the VICTIM's `app`.
    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            attacker_tag_pdas.app_tag.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let ix = stake_tag_ix(
        &program_id,
        &victim_pdas,
        &attacker_tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        1_000,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);

    let err = res.expect_err(
        "expected stake_tag to reject a mismatched (app, app_tag) pair, but it succeeded",
    );
    let logs = err.meta.pretty_logs();
    assert!(
        logs.contains("TagAppMismatch"),
        "expected the rejection to be TagAppMismatch specifically, got logs: {logs}"
    );

    // Nothing moved on the victim's side.
    let victim_app_account = fetch_app(&svm, victim_pdas.app);
    assert_eq!(victim_app_account.total_tag_stake, 0);
}
