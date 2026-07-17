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
        APP_SEED, CONFIG_SEED, REWARD_PRECISION, TAGS_REWARD_VAULT_SEED, VOTE_POSITION_SEED,
        VOTE_REWARD_VAULT_SEED, VOTE_VAULT_SEED,
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

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, `Config`
/// initialized, and a single `AppAccount` (with its three vaults) already
/// registered via `init_app`. Returns the SVM, the deployer keypair, the
/// vote mint, and the registered app's PDAs.
fn setup() -> (LiteSVM, Keypair, Pubkey, AppPdas) {
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

    let app_id = "cid_vote_test_app_0000001".to_string();
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

    (svm, deployer, vote_mint, pdas)
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
/// `vote_acc_reward_per_share`, so tests can exercise the reward-payout leg
/// of `vote()` (normally only nonzero once `fund_app_rewards`, Task 15,
/// exists) without needing that instruction. Deserializes the account's
/// current data, mutates the one field, and re-serializes it (preserving the
/// Anchor discriminator via `AccountSerialize`) back over the same account,
/// keeping its existing lamports/owner.
fn set_app_vote_accumulator(svm: &mut LiteSVM, app: Pubkey, acc_reward_per_share: u128) {
    let mut raw = svm.get_account(&app).expect("app account must exist");
    let mut app_account: nebulous_world::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap();
    app_account.vote_acc_reward_per_share = acc_reward_per_share;

    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&app_account, &mut data).unwrap();
    raw.data = data;
    svm.set_account(app, raw).unwrap();
}

fn vote_ix(
    program_id: &Pubkey,
    pdas: &AppPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::Vote { amount }.data(),
        nebulous_world::accounts::Vote {
            app: pdas.app,
            position: *position,
            vote_vault: pdas.vote_vault,
            vote_reward_vault: pdas.vote_reward_vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_vote_locks_principal_and_creates_position() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

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
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let amount = 4_000u64;
    let instruction = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        amount,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "vote transaction failed: {:?}", res);

    // The position was created with the right owner/amount/reward_debt/bump.
    let position_raw = svm
        .get_account(&position)
        .expect("position account must exist");
    let position_account: nebulous_world::VotePosition =
        anchor_lang::AccountDeserialize::try_deserialize(&mut position_raw.data.as_slice())
            .unwrap();
    assert_eq!(position_account.owner, user.pubkey());
    assert_eq!(position_account.amount, amount);
    // No rewards were ever funded, so the accumulator is still 0 and the
    // fresh checkpoint must be 0 too.
    assert_eq!(position_account.reward_debt, 0);

    // The app's total_vote_stake reflects the new stake.
    let app_raw = svm.get_account(&pdas.app).expect("app account must exist");
    let app_account: nebulous_world::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut app_raw.data.as_slice()).unwrap();
    assert_eq!(app_account.total_vote_stake, amount);

    // Tokens actually moved: vault gained `amount`, user lost `amount`.
    let vault_raw = svm
        .get_account(&pdas.vote_vault)
        .expect("vote vault must exist");
    let vault_account = SplTokenAccount::unpack(&vault_raw.data).unwrap();
    assert_eq!(vault_account.amount, amount);

    let user_raw = svm
        .get_account(&user_token_account)
        .expect("user token account must exist");
    let user_account = SplTokenAccount::unpack(&user_raw.data).unwrap();
    assert_eq!(user_account.amount, 10_000 - amount);
}

#[test]
fn test_vote_rejects_zero_amount() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

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
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    let instruction = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        0,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected vote to reject a zero amount, but it succeeded"
    );
}

#[test]
fn test_vote_accumulates_across_two_deposits() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

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
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    for amount in [1_000u64, 2_500u64] {
        let instruction = vote_ix(
            &program_id,
            &pdas,
            &position,
            &user_token_account,
            &user.pubkey(),
            amount,
        );
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[instruction], Some(&user.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
        let res = svm.send_transaction(tx);
        assert!(res.is_ok(), "vote transaction failed: {:?}", res);
    }

    let position_raw = svm
        .get_account(&position)
        .expect("position account must exist");
    let position_account: nebulous_world::VotePosition =
        anchor_lang::AccountDeserialize::try_deserialize(&mut position_raw.data.as_slice())
            .unwrap();
    assert_eq!(position_account.amount, 3_500);

    let app_raw = svm.get_account(&pdas.app).expect("app account must exist");
    let app_account: nebulous_world::AppAccount =
        anchor_lang::AccountDeserialize::try_deserialize(&mut app_raw.data.as_slice()).unwrap();
    assert_eq!(app_account.total_vote_stake, 3_500);
}

/// Exercises the reward-payout CPI leg of `vote()` end-to-end — the
/// highest-risk path (the `app` PDA actually signing a transfer out of
/// `vote_reward_vault`), which every other test above never touches since
/// they all run with `vote_acc_reward_per_share == 0` (so `settle_pending`
/// is always 0 and `transfer_from_app_vault` always hits its no-op early
/// return). This test votes once to create a nonzero position, manually
/// bumps the app's accumulator (standing in for `fund_app_rewards`, Task
/// 15, which doesn't exist yet) and pre-funds `vote_reward_vault`, then
/// votes again and asserts the pending reward actually lands in the user's
/// wallet and the position's `reward_debt` checkpoints to the new
/// accumulator value.
#[test]
fn test_vote_pays_out_pending_reward_on_second_vote() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

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
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );

    // First vote: creates the position at amount=1_000 with reward_debt=0
    // (accumulator is still 0 at this point).
    let first_amount = 1_000u64;
    let first_ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        first_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[first_ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    svm.send_transaction(tx)
        .expect("first vote must succeed in test setup");

    // Stand in for `fund_app_rewards` (Task 15): bump the accumulator to 1
    // reward token per staked token, and pre-fund the reward vault so the
    // payout CPI has something to actually transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_vote_accumulator(&mut svm, pdas.app, acc_reward_per_share);
    fund_token_account(
        &mut svm,
        pdas.vote_reward_vault,
        vote_mint,
        pdas.app,
        50_000,
    );

    // Expected pending reward: settle_pending(1_000, reward_debt=0, acc=1*PRECISION) = 1_000.
    let expected_pending = 1_000u64;

    let second_amount = 500u64;
    let second_ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        second_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[second_ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "second vote transaction failed: {:?}", res);

    // The position grew by `second_amount` and checkpointed against the new
    // accumulator: reward_debt_for(1_500, 1*PRECISION) = 1_500.
    let position_raw = svm
        .get_account(&position)
        .expect("position account must exist");
    let position_account: nebulous_world::VotePosition =
        anchor_lang::AccountDeserialize::try_deserialize(&mut position_raw.data.as_slice())
            .unwrap();
    assert_eq!(position_account.amount, first_amount + second_amount);
    assert_eq!(position_account.reward_debt, 1_500);

    // The reward actually landed in the user's wallet: started with 10_000,
    // paid `first_amount` + `second_amount` in principal, received
    // `expected_pending` back as reward.
    let user_raw = svm
        .get_account(&user_token_account)
        .expect("user token account must exist");
    let user_account = SplTokenAccount::unpack(&user_raw.data).unwrap();
    assert_eq!(
        user_account.amount,
        10_000 - first_amount - second_amount + expected_pending
    );

    // The reward vault paid out exactly `expected_pending`.
    let reward_vault_raw = svm
        .get_account(&pdas.vote_reward_vault)
        .expect("vote reward vault must exist");
    let reward_vault_account = SplTokenAccount::unpack(&reward_vault_raw.data).unwrap();
    assert_eq!(reward_vault_account.amount, 50_000 - expected_pending);

    // The principal vault holds both deposits.
    let vault_raw = svm
        .get_account(&pdas.vote_vault)
        .expect("vote vault must exist");
    let vault_account = SplTokenAccount::unpack(&vault_raw.data).unwrap();
    assert_eq!(vault_account.amount, first_amount + second_amount);
}
