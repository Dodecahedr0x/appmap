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
        APP_SEED, CONFIG_SEED, TAGS_REWARD_VAULT_SEED, VOTE_POSITION_SEED, VOTE_REWARD_VAULT_SEED,
        VOTE_VAULT_SEED,
    },
    appmap::RewardPool,
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint},
};

/// See `test_initialize.rs` for context: overwrites the appmap program's
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

/// Sets up a fresh LiteSVM instance with the appmap program loaded, `Config`
/// initialized (authority = `deployer`), and a single `AppAccount` (with its
/// three vaults) already registered via `init_app`.
fn setup() -> (LiteSVM, Keypair, Pubkey, AppPdas) {
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

    let app_id = "cid_claim_test_app_000001".to_string();
    let pdas = derive_app_pdas(&program_id, &app_id);
    let init_app_ix = Instruction::new_with_bytes(
        program_id,
        &appmap::instruction::InitApp {
            app_id: app_id.clone(),
        }
        .data(),
        appmap::accounts::InitApp {
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
        &appmap::instruction::Vote { amount }.data(),
        appmap::accounts::Vote {
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

fn fund_app_rewards_ix(
    program_id: &Pubkey,
    pdas: &AppPdas,
    config: &Pubkey,
    funder_token_account: &Pubkey,
    authority: &Pubkey,
    pool: RewardPool,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &appmap::instruction::FundAppRewards { pool, amount }.data(),
        appmap::accounts::FundAppRewards {
            app: pdas.app,
            config: *config,
            vote_reward_vault: pdas.vote_reward_vault,
            tags_reward_vault: pdas.tags_reward_vault,
            funder_token_account: *funder_token_account,
            authority: *authority,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn claim_vote_reward_ix(
    program_id: &Pubkey,
    pdas: &AppPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &appmap::instruction::ClaimVoteReward {}.data(),
        appmap::accounts::ClaimVoteReward {
            app: pdas.app,
            position: *position,
            vote_reward_vault: pdas.vote_reward_vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn fetch_position(svm: &LiteSVM, position: Pubkey) -> appmap::VotePosition {
    let raw = svm
        .get_account(&position)
        .expect("position account must exist");
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

/// Common fixture for every test below: registers an app, funds a fresh
/// user's wallet, votes `stake` in to create a `VotePosition`, then funds
/// the vote pool for real via `fund_app_rewards` with `fund_amount` — so the
/// accumulator and `vote_reward_vault` balance are both genuinely produced
/// by the two instructions under test, not hand-poked into the account like
/// the pre-Task-15 tests in `test_vote.rs`/`test_withdraw_vote.rs` had to
/// do.
fn setup_voted_and_funded(
    stake: u64,
    wallet_amount: u64,
    fund_amount: u64,
) -> (LiteSVM, Pubkey, AppPdas, Keypair, Pubkey, Pubkey) {
    let program_id = appmap::id();
    let (mut svm, deployer, vote_mint, pdas) = setup();
    let (config, _bump) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        vote_mint,
        user.pubkey(),
        wallet_amount,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            user.pubkey().as_ref(),
        ],
        &program_id,
    );
    let ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        stake,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "setup vote must succeed"
    );

    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        vote_mint,
        deployer.pubkey(),
        fund_amount,
    );
    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &config,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Vote,
        fund_amount,
    );
    assert!(
        send(&mut svm, ix, &deployer.pubkey(), &[&deployer]),
        "setup fund_app_rewards must succeed"
    );

    (svm, program_id, pdas, user, user_token_account, position)
}

#[test]
fn test_claim_vote_reward_pays_out_pending_and_leaves_principal_untouched() {
    let stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let fund_amount = 2_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position) =
        setup_voted_and_funded(stake, wallet_amount, fund_amount);

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, reward_debt=0, acc=2*PRECISION) = 2_000.
    let expected_pending = 2_000u64;

    let ix = claim_vote_reward_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let ok = send(&mut svm, ix, &user.pubkey(), &[&user]);
    assert!(ok, "claim_vote_reward transaction failed");

    // Principal is untouched.
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake);
    // reward_debt re-checkpointed to reward_debt_for(1_000, 2*PRECISION) = 2_000.
    assert_eq!(position_account.reward_debt, expected_pending as u128);

    // Reward actually landed: user started with (wallet_amount - stake)
    // after voting, then received `expected_pending`.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - stake + expected_pending
    );
    // The reward vault paid out exactly `expected_pending` (it was funded
    // with `fund_amount`).
    assert_eq!(
        fetch_token_amount(&svm, pdas.vote_reward_vault),
        fund_amount - expected_pending
    );
    // Principal vault is completely untouched by a claim.
    assert_eq!(fetch_token_amount(&svm, pdas.vote_vault), stake);
}

#[test]
fn test_claim_vote_reward_twice_pays_nothing_extra_second_time() {
    let stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let fund_amount = 2_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position) =
        setup_voted_and_funded(stake, wallet_amount, fund_amount);

    let ix = claim_vote_reward_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "first claim must succeed"
    );

    let balance_after_first_claim = fetch_token_amount(&svm, user_token_account);
    let vault_after_first_claim = fetch_token_amount(&svm, pdas.vote_reward_vault);
    let position_after_first_claim = fetch_position(&svm, position);

    // Claim again immediately, with no intervening vote()/fund_app_rewards()
    // call — there is genuinely nothing new to pay out, since reward_debt
    // was already checkpointed against the current (unchanged) accumulator.
    // `expire_blockhash` only forces a distinct transaction signature (the
    // first claim's tx would otherwise be byte-for-byte identical and get
    // rejected by litesvm as an `AlreadyProcessed` duplicate) — it has no
    // bearing on the actual reward math being tested here.
    svm.expire_blockhash();
    let ix = claim_vote_reward_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let ok = send(&mut svm, ix, &user.pubkey(), &[&user]);
    assert!(ok, "second claim_vote_reward transaction failed");

    // Nothing extra moved: user balance, vault balance, and position are all
    // byte-for-byte identical to right after the first claim.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        balance_after_first_claim
    );
    assert_eq!(
        fetch_token_amount(&svm, pdas.vote_reward_vault),
        vault_after_first_claim
    );
    let position_after_second_claim = fetch_position(&svm, position);
    assert_eq!(
        position_after_second_claim.amount,
        position_after_first_claim.amount
    );
    assert_eq!(
        position_after_second_claim.reward_debt,
        position_after_first_claim.reward_debt
    );
}

/// End-to-end: vote -> fund_app_rewards -> claim_vote_reward, with
/// hand-verified numbers throughout.
///
/// stake = 2_500, fund_amount = 10_000
/// acc_reward_per_share = 10_000 * PRECISION / 2_500 = 4 * PRECISION
/// pending = settle_pending(2_500, 0, 4*PRECISION) = 2_500 * 4 = 10_000
/// (the entire funded amount, since this user holds 100% of the stake)
#[test]
fn test_vote_fund_claim_end_to_end_exact_payout() {
    let stake = 2_500u64;
    let wallet_amount = 50_000u64;
    let fund_amount = 10_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position) =
        setup_voted_and_funded(stake, wallet_amount, fund_amount);

    let expected_pending = 10_000u64;
    assert_eq!(
        expected_pending, fund_amount,
        "sole staker must receive the entire funded pool"
    );

    let ix = claim_vote_reward_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "claim must succeed"
    );

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake); // untouched
    assert_eq!(position_account.reward_debt, expected_pending as u128);

    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - stake + expected_pending
    );
    // Reward vault fully drained: sole staker claimed the entire pool.
    assert_eq!(fetch_token_amount(&svm, pdas.vote_reward_vault), 0);
}
