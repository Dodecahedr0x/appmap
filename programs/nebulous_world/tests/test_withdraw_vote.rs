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

/// PDAs for the single global `Config`/vault plus one registered app — see
/// the identical struct in `test_vote.rs` for context on why there is only
/// one vault for the whole program now.
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

    let app_id = "cid_wvote_test_app_000001".to_string();
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
/// of `withdraw_vote()` (normally only nonzero once `fund_app_rewards` has
/// been called) without needing that instruction. Deserializes the account's
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

fn withdraw_vote_ix(
    program_id: &Pubkey,
    pdas: &Pdas,
    position: &Pubkey,
    user_token_account: &Pubkey,
    user: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::WithdrawVote { amount }.data(),
        nebulous_world::accounts::WithdrawVote {
            app: pdas.app,
            position: *position,
            config: pdas.config,
            vault: pdas.vault,
            user_token_account: *user_token_account,
            user: *user,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

/// Common fixture: registers an app, funds a fresh user's wallet with vote
/// tokens, and votes `initial_stake` in to create a `VotePosition`. Returns
/// everything a `withdraw_vote` test needs.
fn setup_with_position(
    initial_stake: u64,
    wallet_amount: u64,
) -> (LiteSVM, Pubkey, Pdas, Keypair, Pubkey, Pubkey, Pubkey) {
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

    let vote_ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        initial_stake,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[vote_ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    svm.send_transaction(tx)
        .expect("initial vote must succeed in test setup");

    (
        svm,
        program_id,
        pdas,
        user,
        user_token_account,
        position,
        vote_mint,
    )
}

fn fetch_position(svm: &LiteSVM, position: Pubkey) -> nebulous_world::VotePosition {
    let raw = svm
        .get_account(&position)
        .expect("position account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn fetch_app(svm: &LiteSVM, app: Pubkey) -> nebulous_world::AppAccount {
    let raw = svm.get_account(&app).expect("app account must exist");
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

/// Even though this withdrawal happens at elapsed=0 (fee_bps would be the
/// full 1% — see `unstake_fee.rs`), `user` is the ONLY staker, so
/// `app.total_vote_stake` drops to 0 after this full withdrawal — there is
/// nobody left in the pool to redistribute a fee to, so `withdraw_vote`
/// waives it entirely (see the "last staker" doc comment on that handler)
/// and the user gets back exactly what they put in, fee-free.
#[test]
fn test_withdraw_vote_full_withdrawal_returns_principal_and_zeroes_position() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position, _vote_mint) =
        setup_with_position(initial_stake, wallet_amount);

    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        initial_stake,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "withdraw_vote transaction failed: {:?}", res);

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, 0);
    assert_eq!(position_account.reward_debt, 0);

    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_vote_stake, 0);
    // No fee was distributed — the pool is empty, nobody to receive it.
    assert_eq!(app_account.vote_acc_reward_per_share, 0);

    assert_eq!(fetch_token_amount(&svm, pdas.vault), 0);
    assert_eq!(fetch_token_amount(&svm, user_token_account), wallet_amount);
}

/// Unlike the full-withdrawal test above, `user` still holds stake after
/// this withdrawal (`app.total_vote_stake` stays > 0), so the elapsed=0 1%
/// unstake fee IS charged here — and since `user` is still the only staker,
/// it's redistributed right back into their own remaining position via
/// `bump_accumulator` (see `withdraw_vote`'s doc comment on why that's the
/// correct, non-special-cased behavior, not a bug).
#[test]
fn test_withdraw_vote_partial_withdrawal_leaves_remaining_stake() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position, _vote_mint) =
        setup_with_position(initial_stake, wallet_amount);

    let withdraw_amount = 1_500u64;
    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "withdraw_vote transaction failed: {:?}", res);

    let remaining = initial_stake - withdraw_amount;
    // Elapsed=0 since setup_with_position's vote and this withdrawal land in
    // the same LiteSVM instance with no explicit warp — full 1% (100 bps).
    let fee =
        nebulous_world::unstake_fee::unstake_fee(withdraw_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    let net_withdraw_amount = withdraw_amount - fee;

    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, remaining);

    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_vote_stake, remaining);
    // The fee was funded into the vote pool's accumulator, denominated
    // against the remaining stake (all of it `user`'s own, here).
    let expected_acc = nebulous_world::reward_math::bump_accumulator(fee, remaining, 0).unwrap();
    assert_eq!(app_account.vote_acc_reward_per_share, expected_acc);

    // The fee portion of `withdraw_amount` stayed in the vault (backing the
    // accumulator bump above) instead of leaving with the rest.
    assert_eq!(fetch_token_amount(&svm, pdas.vault), remaining + fee);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + net_withdraw_amount
    );
}

#[test]
fn test_withdraw_vote_rejects_zero_amount() {
    let (mut svm, program_id, pdas, user, user_token_account, position, _vote_mint) =
        setup_with_position(4_000, 10_000);

    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        0,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected withdraw_vote to reject a zero amount, but it succeeded"
    );
}

#[test]
fn test_withdraw_vote_rejects_amount_exceeding_stake() {
    let initial_stake = 4_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position, _vote_mint) =
        setup_with_position(initial_stake, 10_000);

    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        initial_stake + 1,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected withdraw_vote to reject an over-withdrawal, but it succeeded"
    );

    // Nothing moved: the position and vault are untouched.
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, initial_stake);
    assert_eq!(fetch_token_amount(&svm, pdas.vault), initial_stake);
}

/// Exercises the reward-payout CPI leg of `withdraw_vote()` end-to-end on a
/// PARTIAL withdrawal (not just a full one) — the highest-risk path (the
/// `config` PDA signing two separate transfers out of the single global
/// vault in the same instruction: the pending reward, then the returned
/// principal). Mirrors `test_vote_pays_out_pending_reward_on_second_vote` in
/// `test_vote.rs`: manually bumps the app's accumulator (standing in for
/// `fund_app_rewards`) and tops up the vault with extra "reward" balance on
/// top of the principal it already holds, then withdraws part of the stake
/// and asserts both the pending reward AND the principal actually land in
/// the user's wallet, with the position's `reward_debt` re-checkpointed
/// against the new (smaller) remaining amount.
#[test]
fn test_withdraw_vote_pays_out_pending_reward_on_partial_withdrawal() {
    let initial_stake = 1_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position, vote_mint) =
        setup_with_position(initial_stake, wallet_amount);

    // Stand in for `fund_app_rewards`: bump the accumulator to 1 reward
    // token per staked token, and top up the vault (which already holds
    // `initial_stake` in principal) with extra balance so the payout CPI has
    // something to actually transfer.
    let acc_reward_per_share = REWARD_PRECISION; // 1.0 reward token per staked token
    set_app_vote_accumulator(&mut svm, pdas.app, acc_reward_per_share);
    let reward_topup = 50_000u64;
    fund_token_account(
        &mut svm,
        pdas.vault,
        vote_mint,
        pdas.config,
        initial_stake + reward_topup,
    );

    let withdraw_amount = 400u64;

    // settle_pending(1_000, reward_debt=0, acc=1*PRECISION) = 1_000
    let expected_pending = 1_000u64;

    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "withdraw_vote transaction failed: {:?}", res);

    let position_account = fetch_position(&svm, position);
    let remaining = initial_stake - withdraw_amount;
    assert_eq!(position_account.amount, remaining);
    // reward_debt_for(remaining, 1*PRECISION) = remaining — checkpointed
    // against the accumulator's value BEFORE this withdrawal's own fee-funding
    // bump (see withdraw_vote's doc comment on why that ordering is correct):
    // the manually-set 1.0-per-share accumulator, unaffected by the fee this
    // same instruction bumps it by afterward.
    assert_eq!(position_account.reward_debt, remaining as u128);

    // Elapsed=0 (no warp between setup's vote and this withdrawal) => the
    // full 1% (100 bps) fee applies to the withdrawn amount.
    let fee =
        nebulous_world::unstake_fee::unstake_fee(withdraw_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    let net_withdraw_amount = withdraw_amount - fee;

    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_vote_stake, remaining);
    // The fee was funded on top of the manually-set 1.0-per-share accumulator.
    let expected_acc =
        nebulous_world::reward_math::bump_accumulator(fee, remaining, acc_reward_per_share).unwrap();
    assert_eq!(app_account.vote_acc_reward_per_share, expected_acc);

    // User received the withdrawn principal (net of the unstake fee) and the
    // pending reward.
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + net_withdraw_amount + expected_pending
    );

    // The single global vault: held (initial_stake + reward_topup) before
    // this instruction, paid out `expected_pending` and the NET withdrawal
    // (the fee portion stays behind, backing the accumulator bump above).
    assert_eq!(
        fetch_token_amount(&svm, pdas.vault),
        initial_stake + reward_topup - expected_pending - net_withdraw_amount
    );
}

/// Once `UNSTAKE_FEE_DECAY_SECONDS` (a week) has elapsed since a position's
/// `staked_at` checkpoint, the fee is exactly 0 — a genuinely time-decayed
/// case, distinct from the "last staker" waiver the full-withdrawal test
/// above exercises (this is a PARTIAL withdrawal that leaves stake behind,
/// so the pool is never empty; the fee is 0 purely because enough time has
/// passed, not because there's nobody to fund).
#[test]
fn test_withdraw_vote_fee_decays_to_zero_after_the_decay_window() {
    let initial_stake = 4_000u64;
    let wallet_amount = 10_000u64;
    let (mut svm, program_id, pdas, user, user_token_account, position, _vote_mint) =
        setup_with_position(initial_stake, wallet_amount);

    warp_forward(&mut svm, nebulous_world::constants::UNSTAKE_FEE_DECAY_SECONDS);

    let withdraw_amount = 1_500u64;
    let ix = withdraw_vote_ix(
        &program_id,
        &pdas,
        &position,
        &user_token_account,
        &user.pubkey(),
        withdraw_amount,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "withdraw_vote transaction failed: {:?}", res);

    let remaining = initial_stake - withdraw_amount;
    let position_account = fetch_position(&svm, position);
    assert_eq!(position_account.amount, remaining);

    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_vote_stake, remaining);
    // No fee was charged at all, so nothing was funded into the accumulator.
    assert_eq!(app_account.vote_acc_reward_per_share, 0);

    // Full withdraw_amount returned, fee-free.
    assert_eq!(fetch_token_amount(&svm, pdas.vault), remaining);
    assert_eq!(
        fetch_token_amount(&svm, user_token_account),
        wallet_amount - initial_stake + withdraw_amount
    );
}

/// The unstake fee isn't a burn or a treasury skim — it's redistributed to
/// whoever remains in the pool via the same `bump_accumulator` mechanism
/// `fund_app_rewards` uses. This test proves that redistribution actually
/// reaches a genuinely DIFFERENT staker (not just the withdrawer's own
/// remaining balance, which the partial-withdrawal tests above already
/// cover): user A fully exits and pays a fee; user B, who never withdraws,
/// claims it back out via a real `claim_vote_reward` call.
#[test]
fn test_withdraw_vote_fee_is_redistributed_to_other_stakers() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

    let user_a = Keypair::new();
    svm.airdrop(&user_a.pubkey(), 1_000_000_000).unwrap();
    let a_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, a_token_account, vote_mint, user_a.pubkey(), 10_000);
    let (a_position, _bump) = Pubkey::find_program_address(
        &[VOTE_POSITION_SEED, pdas.app.as_ref(), user_a.pubkey().as_ref()],
        &program_id,
    );

    let user_b = Keypair::new();
    svm.airdrop(&user_b.pubkey(), 1_000_000_000).unwrap();
    let b_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, b_token_account, vote_mint, user_b.pubkey(), 10_000);
    let (b_position, _bump) = Pubkey::find_program_address(
        &[VOTE_POSITION_SEED, pdas.app.as_ref(), user_b.pubkey().as_ref()],
        &program_id,
    );

    // Chosen so `bump_accumulator`/`settle_pending`'s integer division comes
    // out exact (fee=40, PRECISION=1e12, 40e12 / 5_000 = 8e9 exactly) —
    // avoids the same rounding-loss noise `bump_accumulator_matches_settle_pending_round_trip`
    // in reward_math.rs's own tests deliberately sidesteps with the same trick.
    let a_amount = 4_000u64;
    let b_amount = 5_000u64;
    for (position, token_account, user, amount) in [
        (a_position, a_token_account, &user_a, a_amount),
        (b_position, b_token_account, &user_b, b_amount),
    ] {
        let ix = vote_ix(&program_id, &pdas, &position, &token_account, &user.pubkey(), amount);
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
        svm.send_transaction(tx).expect("vote must succeed in test setup");
    }

    // User A fully exits at elapsed=0 (full 1% fee), leaving User B as the
    // pool's sole remaining staker.
    let withdraw_ix = withdraw_vote_ix(&program_id, &pdas, &a_position, &a_token_account, &user_a.pubkey(), a_amount);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[withdraw_ix], Some(&user_a.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_a]).unwrap();
    svm.send_transaction(tx).expect("withdraw_vote must succeed");

    let fee =
        nebulous_world::unstake_fee::unstake_fee(a_amount, nebulous_world::unstake_fee::linear_decay_fee_bps(0))
            .unwrap();
    assert!(fee > 0, "test is only meaningful if a nonzero fee was actually charged");

    let app_account = fetch_app(&svm, pdas.app);
    assert_eq!(app_account.total_vote_stake, b_amount);
    let expected_acc = nebulous_world::reward_math::bump_accumulator(fee, b_amount, 0).unwrap();
    assert_eq!(app_account.vote_acc_reward_per_share, expected_acc);

    // User B never withdrew or re-voted, so their reward_debt is still the
    // 0 it was checkpointed at on their original vote — their full pending
    // balance is exactly their share of User A's fee.
    let expected_pending_for_b =
        nebulous_world::reward_math::settle_pending(b_amount, 0, expected_acc).unwrap();
    assert_eq!(expected_pending_for_b, fee, "B is the sole remaining staker, so ALL of A's fee is theirs");

    let b_balance_before_claim = fetch_token_amount(&svm, b_token_account);
    let claim_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::ClaimVoteReward {}.data(),
        nebulous_world::accounts::ClaimVoteReward {
            app: pdas.app,
            position: b_position,
            config: pdas.config,
            vault: pdas.vault,
            user_token_account: b_token_account,
            user: user_b.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[claim_ix], Some(&user_b.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_b]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "claim_vote_reward transaction failed: {:?}", res);

    assert_eq!(
        fetch_token_amount(&svm, b_token_account),
        b_balance_before_claim + expected_pending_for_b,
        "User B actually received User A's unstake fee via a real claim_vote_reward call"
    );
    let b_position_account = fetch_position(&svm, b_position);
    assert_eq!(
        b_position_account.reward_debt,
        nebulous_world::reward_math::reward_debt_for(b_amount, expected_acc).unwrap()
    );
}
