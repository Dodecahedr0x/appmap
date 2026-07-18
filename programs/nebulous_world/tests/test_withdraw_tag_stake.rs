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

    let app_id = "cid_wstake_test_app_00001".to_string();
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
/// of `withdraw_tag_stake()` without needing a real `fund_app_rewards` call
/// here. See `test_stake_tag.rs`'s copy of this helper for the full
/// rationale.
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

/// Common fixture: registers an app + tag, funds a fresh user's wallet with
/// vote tokens, and stakes `initial_stake` in to create a `StakePosition`.
/// Returns everything a `withdraw_tag_stake` test needs.
fn setup_with_position(
    initial_stake: u64,
    wallet_amount: u64,
) -> (LiteSVM, Env, Pubkey, TagPdas, Keypair, Pubkey, Pubkey) {
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
        initial_stake,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "initial stake_tag must succeed in test setup"
    );

    (svm, env, app, tag_pdas, user, user_token_account, position)
}

/// Even though this withdrawal happens at elapsed=0 (fee_bps would be the
/// full 1% — see `unstake_fee.rs`), `user` is the ONLY tag-staker, so
/// `app.total_tag_stake` drops to 0 after this full withdrawal — nobody
/// left in the shared tags pool to redistribute a fee to, so
/// `withdraw_tag_stake` waives it entirely (mirrors `withdraw_vote`'s
/// "last staker" behavior — see that handler's doc comment) and the user
/// gets back exactly what they put in, fee-free.
#[test]
fn test_withdraw_tag_stake_full_withdrawal_returns_principal_and_zeroes_position() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, wallet_amount);

    let ix = withdraw_tag_stake_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        initial_stake,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "withdraw_tag_stake transaction failed"
    );

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, 0);
    assert_eq!(position_account.reward_debt, 0);

    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, 0);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, 0);
    // No fee was distributed — the shared tags pool is empty, nobody to
    // receive it.
    assert_eq!(app_account.tags_acc_reward_per_share, 0);

    assert_eq!(fetch_token_amount(&svm, env.vault), 0);
    assert_eq!(fetch_token_amount(&svm, user_token_account), wallet_amount);
}

/// Unlike the full-withdrawal test above, `user` still holds stake after
/// this withdrawal (`app.total_tag_stake` stays > 0), so the elapsed=0 1%
/// unstake fee IS charged here — and since `user` is still the only
/// tag-staker, it's redistributed right back into their own remaining
/// position via `bump_accumulator` (see `withdraw_vote`'s doc comment on
/// this exact non-special-cased behavior — `withdraw_tag_stake` mirrors it
/// against the shared tags-pool accumulator).
#[test]
fn test_withdraw_tag_stake_partial_withdrawal_leaves_remaining_stake() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, wallet_amount);

    let withdraw_amount = 1_500u64;
    let ix = withdraw_tag_stake_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "withdraw_tag_stake transaction failed"
    );

    let remaining = initial_stake - withdraw_amount;
    // Elapsed=0 (no warp between setup's stake_tag and this withdrawal) =>
    // the full 1% (100 bps) fee applies to the withdrawn amount.
    let fee =
        nebulous_world::unstake_fee::unstake_fee(withdraw_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    let net_withdraw_amount = withdraw_amount - fee;

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, remaining);

    // Both counters stayed in lockstep.
    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, remaining);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, remaining);
    let expected_acc = nebulous_world::reward_math::bump_accumulator(fee, remaining, 0).unwrap();
    assert_eq!(app_account.tags_acc_reward_per_share, expected_acc);

    // The fee portion of `withdraw_amount` stayed in the vault (backing the
    // accumulator bump above) instead of leaving with the rest.
    assert_eq!(fetch_token_amount(&svm, env.vault), remaining + fee);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + net_withdraw_amount
    );
}

#[test]
fn test_withdraw_tag_stake_rejects_zero_amount() {
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(4_000, 10_000);

    let ix = withdraw_tag_stake_ix(
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
        "expected withdraw_tag_stake to reject a zero amount, but it succeeded"
    );
}

#[test]
fn test_withdraw_tag_stake_rejects_amount_exceeding_stake() {
    let initial_stake = 4_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, 10_000);

    let ix = withdraw_tag_stake_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        initial_stake + 1,
    );
    assert!(
        !send(&mut svm, ix, &user.pubkey(), &[&user]),
        "expected withdraw_tag_stake to reject an over-withdrawal, but it succeeded"
    );

    // Nothing moved: the position, app_tag_stake, and vault are untouched.
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, initial_stake);
    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, initial_stake);
    assert_eq!(fetch_token_amount(&svm, env.vault), initial_stake);
}

/// Exercises the reward-payout CPI leg of `withdraw_tag_stake()` end-to-end
/// on a PARTIAL withdrawal. Unlike the old per-(app, tag) vault design (where
/// TWO DIFFERENT PDAs signed two separate transfers out of two separate
/// vaults in the same instruction), `config` now signs BOTH the
/// pending-reward payout and the returned principal out of the SAME single
/// global vault — so a single before/after vault-balance delta covers both
/// legs at once.
#[test]
fn test_withdraw_tag_stake_pays_out_pending_reward_on_partial_withdrawal() {
    let initial_stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, wallet_amount);

    // Stand in for `fund_app_rewards` (Tags pool): bump the shared
    // accumulator to 1 reward token per staked token, and add reward funds
    // on top of the vault's existing principal balance so the payout CPI
    // (signed by `config`) has something to actually transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_tags_accumulator(&mut svm, app, acc_reward_per_share);
    fund_vault_additional(&mut svm, env.vault, env.vote_mint, env.config, 50_000);
    let vault_before_withdraw = fetch_token_amount(&svm, env.vault);

    let withdraw_amount = 400u64;

    // settle_pending(1_000, reward_debt=0, acc=1*PRECISION) = 1_000
    let expected_pending = 1_000u64;

    let ix = withdraw_tag_stake_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "withdraw_tag_stake transaction failed"
    );

    let remaining = initial_stake - withdraw_amount;
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, remaining);
    // reward_debt_for(remaining, 1*PRECISION) = remaining — checkpointed
    // against the accumulator's value BEFORE this withdrawal's own
    // fee-funding bump (see withdraw_vote's doc comment on why that ordering
    // is correct).
    assert_eq!(position_account.reward_debt, remaining as u128);

    // Elapsed=0 (no warp between setup's stake_tag and this withdrawal) =>
    // the full 1% (100 bps) fee applies to the withdrawn amount.
    let fee =
        nebulous_world::unstake_fee::unstake_fee(withdraw_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    let net_withdraw_amount = withdraw_amount - fee;

    let app_tag_stake_account = fetch_app_tag_stake(&svm, tag_pdas.app_tag_stake);
    assert_eq!(app_tag_stake_account.stake_amount, remaining);
    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, remaining);
    // The fee was funded on top of the manually-set 1.0-per-share accumulator.
    let expected_acc =
        nebulous_world::reward_math::bump_accumulator(fee, remaining, acc_reward_per_share).unwrap();
    assert_eq!(app_account.tags_acc_reward_per_share, expected_acc);

    // User received the withdrawn principal (net of the unstake fee) and the
    // pending reward, both paid by `config` in the same instruction.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + net_withdraw_amount + expected_pending
    );

    // The single shared vault paid out (reward + NET returned principal) —
    // the fee portion stays behind, backing the accumulator bump above.
    assert_eq!(
        fetch_token_amount(&svm, env.vault),
        vault_before_withdraw - expected_pending - net_withdraw_amount
    );
}

/// Regression test for a critical fund-drain vulnerability (see the matching
/// test in `test_stake_tag.rs` for the full exploit writeup): without the
/// `constraint = app_tag_stake.app == app.key()` check on
/// `WithdrawTagStake::app_tag_stake`, an attacker with their OWN legitimate
/// (app, app_tag_stake, position) could call `withdraw_tag_stake` passing
/// their own `app_tag_stake`/`position` alongside a victim's well-funded
/// `app`. The pending-reward leg would then settle against the VICTIM's real
/// `tags_acc_reward_per_share`, and BOTH the reward payout and the returned
/// "principal" would be signed by `config` out of the single global vault —
/// so with the constraint removed, a successful attack would pay the
/// attacker their own already-legitimate principal back a second time PLUS
/// the victim's reward, out of funds that were never theirs to draw against.
/// Asserts the call is rejected with `AppTagStakeMismatch` specifically.
#[test]
fn test_withdraw_tag_stake_rejects_mismatched_app_and_app_tag_stake() {
    let (mut svm, deployer, env, victim_app, _victim_tag_pdas) = setup();

    // The attacker's own, entirely independent app + tag.
    let (attacker_app, attacker_tag_pdas) = register_second_app_and_tag(
        &mut svm,
        &deployer,
        &env,
        "cid_attacker_app_0000002",
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
    // withdrawing against.
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

    // Now attempt to withdraw, but pass the VICTIM's `app` alongside the
    // attacker's own `app_tag_stake`/`position`.
    let ix = withdraw_tag_stake_ix(
        &env,
        &victim_app,
        &attacker_tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        stake_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);

    let err = res.expect_err(
        "expected withdraw_tag_stake to reject a mismatched (app, app_tag_stake) pair, but it succeeded",
    );
    let logs = err.meta.pretty_logs();
    assert!(
        logs.contains("AppTagStakeMismatch"),
        "expected the rejection to be AppTagStakeMismatch specifically, got logs: {logs}"
    );

    // Nothing moved: the victim's pool and the attacker's own position are
    // both untouched.
    let victim_app_account = fetch_app(&svm, victim_app);
    assert_eq!(victim_app_account.total_tag_stake, 0);
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, stake_amount);
}

/// Once `UNSTAKE_FEE_DECAY_SECONDS` (a week) has elapsed since a position's
/// `staked_at` checkpoint, the fee is exactly 0 — the tag-staking mirror of
/// `test_withdraw_vote_fee_decays_to_zero_after_the_decay_window`. A PARTIAL
/// withdrawal (leaves stake behind, so this is genuinely the time-decay
/// path, not the "last staker" waiver).
#[test]
fn test_withdraw_tag_stake_fee_decays_to_zero_after_the_decay_window() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, env, app, tag_pdas, user, user_token_account, position) =
        setup_with_position(initial_stake, wallet_amount);

    warp_forward(&mut svm, nebulous_world::constants::UNSTAKE_FEE_DECAY_SECONDS);

    let withdraw_amount = 1_500u64;
    let ix = withdraw_tag_stake_ix(
        &env,
        &app,
        &tag_pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    assert!(
        send(&mut svm, ix, &user.pubkey(), &[&user]),
        "withdraw_tag_stake transaction failed"
    );

    let remaining = initial_stake - withdraw_amount;
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, remaining);

    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, remaining);
    // No fee was charged at all, so nothing was funded into the accumulator.
    assert_eq!(app_account.tags_acc_reward_per_share, 0);

    assert_eq!(fetch_token_amount(&svm, env.vault), remaining);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + withdraw_amount
    );
}

/// The unstake fee is redistributed to whoever remains staked on the SAME
/// tag, not burned or skimmed — the tag-staking mirror of
/// `test_withdraw_vote_fee_is_redistributed_to_other_stakers`. User A fully
/// exits and pays a fee; user B, who never withdraws, claims it back out via
/// a real `claim_tag_reward` call.
#[test]
fn test_withdraw_tag_stake_fee_is_redistributed_to_other_stakers() {
    let (mut svm, _deployer, env, app, tag_pdas) = setup();

    let user_a = Keypair::new();
    svm.airdrop(&user_a.pubkey(), 1_000_000_000).unwrap();
    let a_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, a_token_account, env.vote_mint, user_a.pubkey(), 10_000);
    let (a_position, _bump) = Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, tag_pdas.app_tag_stake.as_ref(), user_a.pubkey().as_ref()],
        &env.program_id,
    );

    let user_b = Keypair::new();
    svm.airdrop(&user_b.pubkey(), 1_000_000_000).unwrap();
    let b_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, b_token_account, env.vote_mint, user_b.pubkey(), 10_000);
    let (b_position, _bump) = Pubkey::find_program_address(
        &[STAKE_POSITION_SEED, tag_pdas.app_tag_stake.as_ref(), user_b.pubkey().as_ref()],
        &env.program_id,
    );

    // Chosen so `bump_accumulator`/`settle_pending`'s integer division comes
    // out exact — see the matching comment in
    // test_withdraw_vote_fee_is_redistributed_to_other_stakers.
    let a_amount = 4_000u64;
    let b_amount = 5_000u64;
    for (position, token_account, user, amount) in [
        (a_position, a_token_account, &user_a, a_amount),
        (b_position, b_token_account, &user_b, b_amount),
    ] {
        let ix = stake_tag_ix(&env, &app, &tag_pdas, &position, &token_account, &user.pubkey(), amount);
        assert!(send(&mut svm, ix, &user.pubkey(), &[user]), "stake_tag must succeed in test setup");
    }

    // User A fully exits at elapsed=0 (full 1% fee), leaving User B as the
    // shared tags pool's sole remaining staker.
    let withdraw_ix =
        withdraw_tag_stake_ix(&env, &app, &tag_pdas, &a_position, &a_token_account, &user_a.pubkey(), a_amount);
    assert!(
        send(&mut svm, withdraw_ix, &user_a.pubkey(), &[&user_a]),
        "withdraw_tag_stake must succeed"
    );

    let fee =
        nebulous_world::unstake_fee::unstake_fee(a_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    assert!(fee > 0, "test is only meaningful if a nonzero fee was actually charged");

    let app_account = fetch_app(&svm, app);
    assert_eq!(app_account.total_tag_stake, b_amount);
    let expected_acc = nebulous_world::reward_math::bump_accumulator(fee, b_amount, 0).unwrap();
    assert_eq!(app_account.tags_acc_reward_per_share, expected_acc);

    // User B never withdrew or re-staked, so their reward_debt is still the
    // 0 it was checkpointed at on their original stake — their full pending
    // balance is exactly their share of User A's fee.
    let expected_pending_for_b =
        nebulous_world::reward_math::settle_pending(b_amount, 0, expected_acc).unwrap();
    assert_eq!(expected_pending_for_b, fee, "B is the sole remaining staker, so ALL of A's fee is theirs");

    let b_balance_before_claim = fetch_token_amount(&svm, b_token_account);
    let claim_ix = Instruction::new_with_bytes(
        env.program_id,
        &nebulous_world::instruction::ClaimTagReward {}.data(),
        nebulous_world::accounts::ClaimTagReward {
            app,
            app_tag_stake: tag_pdas.app_tag_stake,
            position: b_position,
            config: env.config,
            vault: env.vault,
            user_token_account: b_token_account,
            user: user_b.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    assert!(
        send(&mut svm, claim_ix, &user_b.pubkey(), &[&user_b]),
        "claim_tag_reward transaction failed"
    );

    assert_eq!(
        fetch_token_amount(&svm, b_token_account),
        b_balance_before_claim + expected_pending_for_b,
        "User B actually received User A's unstake fee via a real claim_tag_reward call"
    );
    let b_position_account = fetch_position(&svm, b_position);
    assert_eq!(
        b_position_account.reward_debt,
        nebulous_world::reward_math::reward_debt_for(b_amount, expected_acc).unwrap()
    );
}
