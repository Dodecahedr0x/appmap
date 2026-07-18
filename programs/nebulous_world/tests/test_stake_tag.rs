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
        APP_SEED, APP_TAG_STAKE_SEED, CONFIG_SEED, REWARD_PRECISION, STAKE_POSITION_SEED, TAG_SEED,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_clock::Clock,
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

    let app_id = "cid_stake_test_app_000001".to_string();
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

/// Adds `additional` tokens on top of the vault's CURRENT balance, rather
/// than overwriting it outright the way `fund_token_account` does for a
/// freshly-untouched account. Necessary now that there is only one global
/// vault (see the design note on `Config`): by the time a test wants to
/// stand in for a `fund_app_rewards` payout round, the same vault may
/// already be holding real staked principal from an earlier step in the
/// same test, and clobbering that balance outright would silently corrupt
/// it.
fn fund_vault_additional(svm: &mut LiteSVM, vault: Pubkey, mint: Pubkey, owner: Pubkey, additional: u64) {
    let current = fetch_token_amount(svm, vault);
    fund_token_account(svm, vault, mint, owner, current + additional);
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

/// Advances the LiteSVM instance's on-chain clock by `seconds` — see the
/// matching helper in `test_vote.rs` for why this is necessary at all.
fn warp_forward(svm: &mut LiteSVM, seconds: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    svm.set_sysvar::<Clock>(&clock);
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Pubkey, signers: &[&Keypair]) -> bool {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

#[test]
fn test_stake_tag_locks_principal_and_creates_position() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

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
            tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );

    let amount = 4_000u64;
    let ix = stake_tag_ix(
        &env,
        &app,
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
    // New field: the position now records its own derivation seed.
    assert_eq!(position_account.app_tag_stake, tag_pdas.app_tag_stake);
    // A brand-new position's staked_at is exactly `now` (weighted_avg_timestamp
    // collapses to `now` when the old amount is 0 — see unstake_fee.rs).
    assert_eq!(position_account.staked_at, svm.get_sysvar::<Clock>().unix_timestamp);

    // Both counters moved in lockstep.
    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, amount);
    assert_eq!(app_tag_stake_account.app, app);
    assert_eq!(app_tag_stake_account.tag, tag_pdas.tag);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, amount);

    assert_eq!(fetch_token_amount(&svm, env.vault), amount);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - amount
    );
}

#[test]
fn test_stake_tag_rejects_zero_amount() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

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
        0,
    );
    assert!(
        !send(&mut svm, ix, &user.pubkey(), &[&user]),
        "expected stake_tag to reject a zero amount, but it succeeded"
    );
}

#[test]
fn test_stake_tag_accumulates_across_two_deposits() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

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
            tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );

    for amount in [1_000u64, 2_500u64] {
        let ix = stake_tag_ix(
            &env,
            &app,
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

    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, 3_500);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, 3_500);
}

/// `staked_at` is a size-weighted average across deposits (see
/// `unstake_fee::weighted_avg_timestamp`) — the tag-staking mirror of
/// `test_vote_staked_at_is_a_weighted_average_across_deposits` in
/// `test_vote.rs`; see that test's doc comment for the full rationale
/// (a "first deposit only" checkpoint would let a stale, fully-decayed
/// timestamp cover an arbitrarily large later top-up fee-free).
#[test]
fn test_stake_tag_staked_at_is_a_weighted_average_across_deposits() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let user_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, user_token_account, env.vote_mint, user.pubkey(), 1_000_100);

    let (position, _bump) = Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, tag_pdas.app_tag_stake.as_ref(), user.pubkey().as_ref()],
        &env.program_id,
    );

    let first_amount = 100u64;
    let first_ix = stake_tag_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), first_amount);
    assert!(send(&mut svm, first_ix, &user.pubkey(), &[&user]), "first stake_tag must succeed");
    let staked_at_after_first = fetch_position(&svm, position).staked_at;

    let elapsed = 7 * 24 * 60 * 60;
    warp_forward(&mut svm, elapsed);
    let second_amount = 1_000_000u64;
    let second_ix = stake_tag_ix(&env, &app, &tag_pdas, &position, &user_token_account, &user.pubkey(), second_amount);
    assert!(send(&mut svm, second_ix, &user.pubkey(), &[&user]), "second stake_tag must succeed");

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, first_amount + second_amount);

    let expected_staked_at = nebulous_world::unstake_fee::weighted_avg_timestamp(
        staked_at_after_first,
        first_amount,
        staked_at_after_first + elapsed,
        second_amount,
    );
    assert_eq!(position_account.staked_at, expected_staked_at);
    let moved = position_account.staked_at - staked_at_after_first;
    assert!(
        moved >= elapsed * 99 / 100,
        "a 10_000x top-up should move staked_at at least 99% of the way to the top-up time, \
         moved {moved}s of {elapsed}s"
    );
}

/// Exercises the reward-payout CPI leg of `stake_tag()` end-to-end — the
/// highest-risk path (`config`, the single authority for the whole shared
/// vault, signing a transfer out of it), which every other test above never
/// touches since they all run with `tags_acc_reward_per_share == 0`. This
/// test stakes once to create a nonzero position, manually bumps the app's
/// tags accumulator (standing in for `fund_app_rewards` targeting the Tags
/// pool) and adds reward funds on top of the vault's existing principal
/// balance, then stakes again and asserts the pending reward actually lands
/// in the user's wallet and the position's `reward_debt` checkpoints to the
/// new accumulator value.
#[test]
fn test_stake_tag_pays_out_pending_reward_on_second_stake() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

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
            tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );

    let first_amount = 1_000u64;
    let first_ix = stake_tag_ix(
        &env,
        &app,
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
    // accumulator to 1 reward token per staked token, and add reward funds
    // on top of whatever the SHARED global vault already holds (the first
    // deposit's principal) so the payout CPI has something to transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_tags_accumulator(&mut svm, app, acc_reward_per_share);
    fund_vault_additional(&mut svm, env.vault, env.vote_mint, env.config, 50_000);
    let vault_before_second_stake = fetch_token_amount(&svm, env.vault);

    // settle_pending(1_000, reward_debt=0, acc=1*PRECISION) = 1_000.
    let expected_pending = 1_000u64;

    let second_amount = 500u64;
    let second_ix = stake_tag_ix(
        &env,
        &app,
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

    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, first_amount + second_amount);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, first_amount + second_amount);

    // The reward actually landed in the user's wallet, signed by `config` —
    // started with 10_000, paid principal deposits, received
    // `expected_pending` back as reward.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        10_000 - first_amount - second_amount + expected_pending
    );

    // The single shared vault moved by exactly (principal in) - (reward
    // out) on top of whatever it held going into this transaction.
    assert_eq!(
        fetch_token_amount(&svm, env.vault),
        vault_before_second_stake - expected_pending + second_amount
    );
}

/// Regression test for a critical fund-drain vulnerability: without the
/// `constraint = app_tag_stake.app == app.key()` check on
/// `StakeTag::app_tag_stake`, each of `app`/`app_tag_stake`'s seeds/bump
/// constraints only proves internal self-consistency — NEITHER proves the
/// two accounts belong together. An attacker could permissionlessly create
/// their OWN (app, app_tag_stake) pair via `init_app`/`suggest_tag`, then
/// call `stake_tag` passing THEIR `app_tag_stake` alongside a victim's
/// well-funded `app`, crediting the attacker's position against the
/// victim's `total_tag_stake`/`tags_acc_reward_per_share` — a
/// permissionless, capital-light path to draining the single global vault
/// (shared by every app in the program, not just the victim's own) once its
/// accumulator advances from legitimate funding.
///
/// This test builds exactly that mismatched pair (a second, independent
/// app+tag standing in for the "attacker's own") and asserts `stake_tag`
/// rejects it with `AppTagStakeMismatch`, not merely "some error".
#[test]
fn test_stake_tag_rejects_mismatched_app_and_app_tag_stake() {
    let (mut svm, deployer, env, victim_app, _victim_tag_pdas) = setup();

    // The attacker's own, entirely independent app + tag.
    let (_attacker_app, attacker_tag_pdas) = register_second_app_and_tag(
        &mut svm,
        &deployer,
        &env,
        "cid_attacker_app_0000001",
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

    // Position PDA derived off the ATTACKER's app_tag_stake (matching what
    // `stake_tag`'s own `position` seeds constraint expects for this
    // `app_tag_stake`), but the instruction passes the VICTIM's `app`.
    let (position, _bump) = Pubkey::find_program_address(
        &[
            STAKE_POSITION_SEED,
            attacker_tag_pdas.app_tag_stake.as_ref(),
            user.pubkey().as_ref(),
        ],
        &env.program_id,
    );

    let ix = stake_tag_ix(
        &env,
        &victim_app,
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
        "expected stake_tag to reject a mismatched (app, app_tag_stake) pair, but it succeeded",
    );
    let logs = err.meta.pretty_logs();
    assert!(
        logs.contains("AppTagStakeMismatch"),
        "expected the rejection to be AppTagStakeMismatch specifically, got logs: {logs}"
    );

    // Nothing moved on the victim's side.
    let victim_app_account = fetch_app(&svm, victim_app);
    assert_eq!(victim_app_account.total_tag_stake, 0);
}
