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
    nebulous_world::constants::{APP_SEED, CONFIG_SEED, REWARD_PRECISION, VOTE_POSITION_SEED},
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

/// PDAs for the single global `Config`/vault plus one registered app — there
/// is exactly one vault for the whole program now (see the design note on
/// `Config`), so unlike the pre-refactor tests there is nothing app-specific
/// to derive beyond `app` itself.
struct Pdas {
    config: Pubkey,
    vault: Pubkey,
    app: Pubkey,
}

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, `Config`
/// + the single global vault initialized (authority = `deployer`), and a
/// single `AppAccount` already registered via `init_app`. Returns the SVM,
/// the deployer keypair, the vote mint, and the relevant PDAs.
fn setup() -> (LiteSVM, Keypair, Pubkey, Pdas) {
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

    let app_id = "cid_vote_test_app_0000001".to_string();
    let (app, _bump) = Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], &program_id);
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

    (svm, deployer, vote_mint, Pdas { config, vault, app })
}

/// Directly writes a funded, initialized SPL token account owned by `owner`
/// for `mint`, holding `amount` tokens — bypassing the token program's
/// `InitializeAccount`/`MintTo` instructions since we only need the end
/// state, mirroring how `setup()` above fabricates the mint account. Also
/// used to top up the single global vault directly (owner = `config`),
/// standing in for a real `fund_app_rewards` call.
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
/// of `vote()` (normally only nonzero once `fund_app_rewards` has been
/// called) without needing that instruction. Deserializes the account's
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
    pdas: &Pdas,
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
            config: pdas.config,
            vault: pdas.vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn fetch_token_amount(svm: &LiteSVM, pubkey: Pubkey) -> u64 {
    let raw = svm.get_account(&pubkey).expect("token account must exist");
    SplTokenAccount::unpack(&raw.data).unwrap().amount
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

    // The position was created with the right app/owner/amount/reward_debt.
    let position_raw = svm
        .get_account(&position)
        .expect("position account must exist");
    let position_account: nebulous_world::VotePosition =
        anchor_lang::AccountDeserialize::try_deserialize(&mut position_raw.data.as_slice())
            .unwrap();
    assert_eq!(position_account.app, pdas.app);
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

    // Tokens actually moved: the single global vault gained `amount`, user
    // lost `amount`.
    assert_eq!(fetch_token_amount(&svm, pdas.vault), amount);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - amount
    );
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
/// highest-risk path (the `config` PDA actually signing a transfer out of
/// the single global vault), which every other test above never touches
/// since they all run with `vote_acc_reward_per_share == 0` (so
/// `settle_pending` is always 0 and `transfer_from_vault` always hits its
/// no-op early return). This test votes once to create a nonzero position,
/// manually bumps the app's accumulator (standing in for `fund_app_rewards`)
/// and tops up the global vault with extra "reward" balance, then votes
/// again and asserts the pending reward actually lands in the user's wallet
/// and the position's `reward_debt` checkpoints to the new accumulator
/// value.
///
/// Unlike the pre-refactor version of this test (which pre-funded a
/// dedicated `vote_reward_vault` separate from `vote_vault`), there is now
/// only one vault: the "reward top-up" is added directly on top of the
/// principal balance already sitting in `vault` from the first vote.
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

    // Stand in for `fund_app_rewards`: bump the accumulator to 1 reward
    // token per staked token, and top up the vault (which already holds
    // `first_amount` in principal from the vote above) with extra balance so
    // the payout CPI has something to actually transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_vote_accumulator(&mut svm, pdas.app, acc_reward_per_share);
    let reward_topup = 50_000u64;
    fund_token_account(
        &mut svm,
        pdas.vault,
        vote_mint,
        pdas.config,
        first_amount + reward_topup,
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

    // The single global vault: held (first_amount + reward_topup) before
    // this instruction, paid out `expected_pending`, then received
    // `second_amount` of fresh principal.
    assert_eq!(
        fetch_token_amount(&svm, pdas.vault),
        first_amount + reward_topup - expected_pending + second_amount
    );
}
