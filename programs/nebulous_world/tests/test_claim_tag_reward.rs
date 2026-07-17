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
    nebulous_world::RewardPool,
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

/// `setup()`'s app_id, hoisted to a shared constant so the shared-accumulator
/// test below can derive `setup()`'s `app` PDA independently (to suggest an
/// ADDITIONAL tag onto it) without duplicating the literal or having to
/// thread it back out of `setup()`'s return tuple.
const APP_ID: &str = "cid_ctag_test_app_000001";

/// Bundles the program-wide singletons every instruction in this file needs:
/// `Config`'s own PDA and the single global vault derived from it (an ATA of
/// `config` for `vote_mint` — see the design note on `Config`), plus
/// `vote_mint`/`program_id` for convenience. Set up once by `setup()` via a
/// real `initialize()` call.
struct Env {
    program_id: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    vote_mint: Pubkey,
}

/// The two PDAs `suggest_tag` creates for one (app, tag_id) pair: the GLOBAL
/// `Tag` identity (shared across every app that suggests the same tag_id,
/// seeded only by `tag_id` — no `app`) and the per-(app, tag) `AppTagStake`
/// stake-accounting link (seeded by `[app, tag]`). Mirrors the old file's
/// `TagPdas`, updated for the two-account split.
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
/// and the single global vault initialized (via a real `initialize()` call),
/// one `AppAccount` registered via `init_app`, and one tag suggested via
/// `suggest_tag` (creating both the global `Tag` and its `AppTagStake`).
/// Returns the SVM, the deployer keypair, the shared `Env`, the app's
/// pubkey, and the tag's PDAs.
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

    let app_id = APP_ID.to_string();
    let app = derive_app(&program_id, &app_id);
    let init_app_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.clone(),
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

/// Registers an ADDITIONAL app + tag pair (distinct from `setup()`'s), using
/// the same already-initialized `Config`/global vault/`vote_mint`/`deployer`.
/// Used by the cross-app mismatch regression test below, which needs two
/// independent (app, app_tag_stake) pairs to construct a mismatched
/// instruction call.
fn register_second_app_and_tag(
    svm: &mut LiteSVM,
    deployer: &Keypair,
    env: &Env,
    app_id: &str,
    tag_id: &str,
) -> (Pubkey, TagPdas) {
    let app = derive_app(&env.program_id, app_id);
    let init_app_ix = Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.to_string(),
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
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("init_app (second app) must succeed in test setup");

    let tag_pdas = derive_tag_pdas(&env.program_id, &app, tag_id);
    let suggest_tag_ix = Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: app_id.to_string(),
            tag_id: tag_id.to_string(),
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
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("suggest_tag (second app) must succeed in test setup");

    (app, tag_pdas)
}

/// Suggests an ADDITIONAL tag under the SAME `app` as `setup()`'s (as
/// opposed to `register_second_app_and_tag`, which registers an entirely
/// separate app). Used by the shared-accumulator test below, which needs
/// two different `app_tag_stake`s competing for the same app-level reward
/// pool.
fn suggest_additional_tag(
    svm: &mut LiteSVM,
    deployer: &Keypair,
    env: &Env,
    app: Pubkey,
    tag_id: &str,
) -> TagPdas {
    let tag_pdas = derive_tag_pdas(&env.program_id, &app, tag_id);
    let suggest_tag_ix = Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: APP_ID.to_string(),
            tag_id: tag_id.to_string(),
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
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("suggest_tag (additional tag on the same app) must succeed in test setup");
    tag_pdas
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

fn fund_app_rewards_ix(
    env: &Env,
    app: &Pubkey,
    funder_token_account: &Pubkey,
    authority: &Pubkey,
    pool: RewardPool,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::FundAppRewards { pool, amount }.data(),
        nebulous_world::accounts::FundAppRewards {
            app: *app,
            config: env.config,
            vault: env.vault,
            funder_token_account: *funder_token_account,
            authority: *authority,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn claim_tag_reward_ix(
    env: &Env,
    app: &Pubkey,
    tag_pdas: &TagPdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::ClaimTagReward {}.data(),
        nebulous_world::accounts::ClaimTagReward {
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

fn fetch_app_tag_stake(svm: &LiteSVM, app_tag_stake: Pubkey) -> nebulous_world::AppTagStake {
    let raw = svm
        .get_account(&app_tag_stake)
        .expect("app_tag_stake account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn fetch_token_amount(svm: &LiteSVM, pubkey: Pubkey) -> u64 {
    let raw = svm.get_account(&pubkey).expect("token account must exist");
    SplTokenAccount::unpack(&raw.data).unwrap().amount
}

/// Common fixture for every test below: registers an app + tag, funds a
/// fresh user's wallet, stakes `stake` in to create a `StakePosition`, then
/// funds the TAGS pool for real via `fund_app_rewards` with `fund_amount` —
/// so the accumulator and the global vault's balance are both genuinely
/// produced by the two instructions under test, not hand-poked into the
/// account.
fn setup_staked_and_funded(
    stake: u64,
    wallet_amount: u64,
    fund_amount: u64,
) -> (LiteSVM, Env, Pubkey, TagPdas, Keypair, Pubkey, Pubkey) {
    let (mut svm, deployer, env, app, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        env.vote_mint,
        user.pubkey(),
        wallet_amount,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );
    let ix = stake_tag_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        stake,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "setup stake_tag must succeed"
    );

    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        env.vote_mint,
        deployer.pubkey(),
        fund_amount,
    );
    let ix = fund_app_rewards_ix(
        &env,
        &app,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Tags,
        fund_amount,
    );
    assert!(
        send(&mut svm, ix, &deployer.pubkey(), &[&deployer]),
        "setup fund_app_rewards must succeed"
    );

    (svm, env, app, tag_pdas, user, user_token_account, position)
}

#[test]
fn test_claim_tag_reward_pays_out_pending_and_leaves_principal_untouched() {
    let stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let fund_amount = 2_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_staked_and_funded(stake, wallet_amount, fund_amount);

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, reward_debt=0, acc=2*PRECISION) = 2_000.
    let expected_pending = 2_000u64;

    let ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let ok = send(&mut svm, ix, &user.pubkey(), &[&user]);
    assert!(ok, "claim_tag_reward transaction failed");

    // Principal is untouched.
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake);
    // reward_debt re-checkpointed to reward_debt_for(1_000, 2*PRECISION) = 2_000.
    assert_eq!(position_account.reward_debt, expected_pending as u128);

    // Reward actually landed: user started with (wallet_amount - stake)
    // after staking, then received `expected_pending`.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - stake + expected_pending
    );
    // The single global vault holds the staked principal (`stake`) plus the
    // funded round (`fund_amount`), minus whatever was just claimed out of
    // it — unlike the old dedicated `tags_reward_vault`, this vault also
    // custodies the stake principal, so the balance check must account for
    // both.
    assert_eq!(
        fetch_token_amount(&svm, env.vault),
        stake + fund_amount - expected_pending
    );
    // app_tag_stake completely untouched by a claim.
    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, stake);
}

#[test]
fn test_claim_tag_reward_twice_pays_nothing_extra_second_time() {
    let stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let fund_amount = 2_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_staked_and_funded(stake, wallet_amount, fund_amount);

    let ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "first claim must succeed"
    );

    let balance_after_first_claim = fetch_token_amount(&svm, user_token_account);
    let vault_after_first_claim = fetch_token_amount(&svm, env.vault);
    let position_after_first_claim = fetch_position(&svm, position);

    // Claim again immediately, with no intervening stake_tag()/
    // fund_app_rewards() call — there is genuinely nothing new to pay out.
    // `expire_blockhash` only forces a distinct transaction signature (the
    // first claim's tx would otherwise be byte-for-byte identical and get
    // rejected by litesvm as an `AlreadyProcessed` duplicate).
    svm.expire_blockhash();
    let ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let ok = send(&mut svm, ix, &user.pubkey(), &[&user]);
    assert!(ok, "second claim_tag_reward transaction failed");

    // Nothing extra moved: user balance, vault balance, and position are all
    // byte-for-byte identical to right after the first claim.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        balance_after_first_claim
    );
    assert_eq!(fetch_token_amount(&svm, env.vault), vault_after_first_claim);
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

#[test]
fn test_claim_tag_reward_zero_pending_is_a_harmless_no_op() {
    // Stake in, but never fund the tags pool: pending is genuinely 0.
    let stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        env.vote_mint,
        user.pubkey(),
        wallet_amount,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );
    let ix = stake_tag_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        stake,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "setup stake_tag must succeed"
    );

    let ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let ok = send(&mut svm, ix, &user.pubkey(), &[&user]);
    assert!(ok, "zero-pending claim_tag_reward must succeed as a no-op");

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake);
    assert_eq!(position_account.reward_debt, 0);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - stake
    );
}

/// Regression test for a critical fund-drain vulnerability (see the matching
/// tests in `test_stake_tag.rs`/`test_withdraw_tag_stake.rs` for the full
/// exploit writeup): without the `constraint = app_tag_stake.app ==
/// app.key()` check on `ClaimTagReward::app_tag_stake`, an attacker with
/// their OWN legitimate (app, app_tag_stake, position) could call
/// `claim_tag_reward` passing their own `app_tag_stake`/`position` alongside
/// a victim's well-funded `app`. The claim would then settle against the
/// VICTIM's real `tags_acc_reward_per_share` and pay out of the single
/// shared vault, which also custodies the victim's real funded reward round.
/// Asserts the call is rejected with `AppTagStakeMismatch` specifically.
#[test]
fn test_claim_tag_reward_rejects_mismatched_app_and_app_tag_stake() {
    let (mut svm, deployer, env, victim_app, victim_tag_pdas) = setup();

    // Fund the VICTIM's tags reward pool for real, so there's something
    // juicy to try to steal. Needs a staker on the victim's own tag first,
    // since `fund_app_rewards` rejects funding an empty pool.
    let victim_staker = Keypair::new();
    svm.airdrop(&victim_staker.pubkey(), 1_000_000_000).unwrap();
    let victim_staker_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        victim_staker_token_account,
        env.vote_mint,
        victim_staker.pubkey(),
        10_000,
    );
    let (victim_position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            victim_tag_pdas.app_tag_stake.as_ref(),
            victim_staker.pubkey().as_ref(),
        ],
        &env.program_id,
    );
    let victim_stake_ix = stake_tag_ix(
        &env,
        &victim_app,
        &victim_tag_pdas,
        &victim_position,
        &victim_staker_token_account,
        &victim_staker.pubkey(),
        1_000,
    );
    assert!(
        send(
            &mut svm,
            victim_stake_ix,
            &victim_staker.pubkey(),
            &[&victim_staker]
        ),
        "victim's own stake_tag must succeed in test setup"
    );

    let victim_funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        victim_funder_token_account,
        env.vote_mint,
        deployer.pubkey(),
        50_000,
    );
    let fund_ix = fund_app_rewards_ix(
        &env,
        &victim_app,
        &victim_funder_token_account,
        &deployer.pubkey(),
        RewardPool::Tags,
        50_000,
    );
    assert!(
        send(&mut svm, fund_ix, &deployer.pubkey(), &[&deployer]),
        "fund_app_rewards on the victim's pool must succeed in test setup"
    );

    // The attacker's own, entirely independent app + tag.
    let (attacker_app, attacker_tag_pdas) = register_second_app_and_tag(
        &mut svm,
        &deployer,
        &env,
        "cid_attacker_app_0000003",
        "attacker_tag",
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        user_token_account,
        env.vote_mint,
        user.pubkey(),
        10_000,
    );

    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            attacker_tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );

    // A legitimate stake under the attacker's OWN, correctly-matched
    // (app, app_tag_stake) pair — establishes a real position to attempt
    // claiming against.
    let stake_amount = 1_000u64;
    let legit_stake_ix = stake_tag_ix(
        &env,
        &attacker_app,
        &attacker_tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        stake_amount,
    );
    assert!(
        send(&mut svm, legit_stake_ix, &user.pubkey(), &[&user]),
        "legitimate stake_tag under the attacker's own app must succeed in test setup"
    );

    // Capture the shared vault's balance right before the attack attempt,
    // so "nothing moved" can be asserted as a before/after delta rather than
    // an absolute number — the vault is shared by every app in the program,
    // so its absolute balance at this point already includes the victim's
    // stake+funding AND the attacker's own legitimate stake above.
    let vault_before_attack = fetch_token_amount(&svm, env.vault);

    // Now attempt to claim, but pass the VICTIM's `app` alongside the
    // attacker's own `app_tag_stake`/`position`.
    let ix = claim_tag_reward_ix(
        &env,
        &victim_app,
        &attacker_tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);

    let err = res.expect_err(
        "expected claim_tag_reward to reject a mismatched (app, app_tag_stake) pair, but it succeeded",
    );
    let logs = err.meta.pretty_logs();
    assert!(
        logs.contains("AppTagStakeMismatch"),
        "expected the rejection to be AppTagStakeMismatch specifically, got logs: {logs}"
    );

    // Nothing moved: the shared vault and the attacker's own position are
    // both untouched.
    assert_eq!(fetch_token_amount(&svm, env.vault), vault_before_attack);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - stake_amount
    );
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake_amount);
}

/// Coverage for the tags pool's defining behavior, never exercised
/// end-to-end elsewhere in this task set: `app.tags_acc_reward_per_share`
/// and `app.total_tag_stake` are SHARED across every tag of the same app,
/// even though each tag has its own `AppTagStake` accounting record. Two
/// different stakers, staked into two DIFFERENT tags of the SAME app, must
/// fairly split a single `fund_app_rewards(Tags)` round proportional to
/// their stake relative to the COMBINED total across both tags — not
/// proportional to either tag's own stake in isolation (there is no such
/// per-tag quantity). Every other test in this file only ever involves one
/// tag per app (`test_stake_tag_accumulates_across_two_deposits` in
/// `test_stake_tag.rs` covers two deposits into the *same* tag, which is a
/// different property).
#[test]
fn test_claim_tag_reward_splits_shared_accumulator_proportionally_across_two_tags() {
    let (mut svm, deployer, env, app, tag_a_pdas) = setup(); // tag A = "defi"

    // A second, independent tag on the SAME app as `setup()`'s "defi" tag —
    // the crux of this test: two different `app_tag_stake` PDAs, one shared
    // `app`.
    let tag_b_pdas = suggest_additional_tag(&mut svm, &deployer, &env, app, "gaming");

    // Staker A stakes 1_000 into tag A ("defi").
    let staker_a = Keypair::new();
    svm.airdrop(&staker_a.pubkey(), 1_000_000_000).unwrap();
    let staker_a_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        staker_a_token_account,
        env.vote_mint,
        staker_a.pubkey(),
        10_000,
    );
    let (position_a, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_a_pdas.app_tag_stake.as_ref(),
            staker_a.pubkey().as_ref(),
        ],
        &env.program_id,
    );
    let stake_a = 1_000u64;
    let ix = stake_tag_ix(
        &env,
        &app,
        &tag_a_pdas,
        &position_a,
        &staker_a_token_account,
        &staker_a.pubkey(),
        stake_a,
    );
    assert!(
        send(&mut svm, ix, &staker_a.pubkey(), &[&staker_a]),
        "staker A's stake_tag into tag A must succeed"
    );

    // Staker B stakes 3_000 into tag B ("gaming") — a DIFFERENT tag, SAME
    // app.
    let staker_b = Keypair::new();
    svm.airdrop(&staker_b.pubkey(), 1_000_000_000).unwrap();
    let staker_b_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        staker_b_token_account,
        env.vote_mint,
        staker_b.pubkey(),
        10_000,
    );
    let (position_b, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            tag_b_pdas.app_tag_stake.as_ref(),
            staker_b.pubkey().as_ref(),
        ],
        &env.program_id,
    );
    let stake_b = 3_000u64;
    let ix = stake_tag_ix(
        &env,
        &app,
        &tag_b_pdas,
        &position_b,
        &staker_b_token_account,
        &staker_b.pubkey(),
        stake_b,
    );
    assert!(
        send(&mut svm, ix, &staker_b.pubkey(), &[&staker_b]),
        "staker B's stake_tag into tag B must succeed"
    );

    // total_tag_stake is now 4_000, shared across both tags — not tracked
    // per-tag anywhere.
    let app_account: nebulous_world::AppAccount = {
        let raw = svm.get_account(&app).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
    };
    assert_eq!(app_account.total_tag_stake, stake_a + stake_b);

    // Fund the Tags pool ONCE, for the whole app — not per-tag.
    let fund_amount = 4_000u64;
    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        env.vote_mint,
        deployer.pubkey(),
        fund_amount,
    );
    let ix = fund_app_rewards_ix(
        &env,
        &app,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Tags,
        fund_amount,
    );
    assert!(
        send(&mut svm, ix, &deployer.pubkey(), &[&deployer]),
        "fund_app_rewards(Tags) must succeed"
    );

    // acc = 4_000 * PRECISION / 4_000 = 1 * PRECISION.
    // Staker A: settle_pending(1_000, 0, 1*PRECISION) = 1_000 (1/4 of the pool).
    // Staker B: settle_pending(3_000, 0, 1*PRECISION) = 3_000 (3/4 of the pool).
    let expected_a = 1_000u64;
    let expected_b = 3_000u64;
    assert_eq!(
        expected_a + expected_b,
        fund_amount,
        "the two shares must exhaust the whole funded round"
    );

    let vault_before_claims = fetch_token_amount(&svm, env.vault);

    let claim_a_ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_a_pdas,
        &position_a,
        &staker_a_token_account,
        &staker_a.pubkey(),
    );
    assert!(
        send(&mut svm, claim_a_ix, &staker_a.pubkey(), &[&staker_a]),
        "staker A's claim_tag_reward must succeed"
    );

    let claim_b_ix = claim_tag_reward_ix(
        &env,
        &app,
        &tag_b_pdas,
        &position_b,
        &staker_b_token_account,
        &staker_b.pubkey(),
    );
    assert!(
        send(&mut svm, claim_b_ix, &staker_b.pubkey(), &[&staker_b]),
        "staker B's claim_tag_reward must succeed"
    );

    // Each staker received exactly their proportional share of the SAME
    // funding round, purely as a function of their stake relative to the
    // combined total — regardless of which specific tag they staked into.
    assert_eq!(
        fetch_token_amount(&svm, staker_a_token_account),
        10_000 - stake_a + expected_a
    );
    assert_eq!(
        fetch_token_amount(&svm, staker_b_token_account),
        10_000 - stake_b + expected_b
    );

    // The shared vault paid out exactly the whole funded round (both claims
    // combined), on top of whatever it held going into the claims (the two
    // stakers' still-locked principal).
    assert_eq!(
        fetch_token_amount(&svm, env.vault),
        vault_before_claims - expected_a - expected_b
    );
    // Both tags' principal is still fully accounted for inside the shared
    // vault — a claim never touches stake_amount/principal.
    let app_tag_a_account = fetch_app_tag_stake(&svm, tag_a_pdas.app_tag_stake);
    assert_eq!(app_tag_a_account.stake_amount, stake_a);
    let app_tag_b_account = fetch_app_tag_stake(&svm, tag_b_pdas.app_tag_stake);
    assert_eq!(app_tag_b_account.stake_amount, stake_b);
}
