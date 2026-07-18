use {
    anchor_lang::solana_program::{
        bpf_loader_upgradeable::{self, UpgradeableLoaderState},
        program_option::COption,
        program_pack::Pack,
        pubkey::Pubkey,
        system_program,
    },
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    anchor_spl::associated_token::{
        get_associated_token_address, ID as ASSOCIATED_TOKEN_PROGRAM_ID,
    },
    anchor_spl::token::ID as TOKEN_PROGRAM_ID,
    nebulous_world::constants::{APP_SEED, CONFIG_SEED, REWARD_PRECISION, VOTE_POSITION_SEED},
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

/// `app` is the registered `AppAccount` under test; `config`/`vault` are the
/// program-wide singletons (one `Config` PDA, one global vault ATA owned by
/// it) that every app shares — there is no per-app vault anymore.
struct Pdas {
    app: Pubkey,
    config: Pubkey,
    vault: Pubkey,
}

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded, `Config`
/// + the single global vault initialized (authority = `deployer`), and a
/// single `AppAccount` already registered via `init_app`. Returns the SVM,
/// the deployer keypair (who is also `Config.authority`), the vote mint, and
/// the relevant PDAs.
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

    let app_id = "cid_fund_test_app_0000001".to_string();
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

    (svm, deployer, vote_mint, Pdas { app, config, vault })
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

fn fund_app_rewards_ix(
    program_id: &Pubkey,
    pdas: &Pdas,
    funder_token_account: &Pubkey,
    authority: &Pubkey,
    pool: RewardPool,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::FundAppRewards { pool, amount }.data(),
        nebulous_world::accounts::FundAppRewards {
            app: pdas.app,
            config: pdas.config,
            vault: pdas.vault,
            funder_token_account: *funder_token_account,
            authority: *authority,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn fetch_app(svm: &LiteSVM, app: Pubkey) -> nebulous_world::AppAccount {
    let raw = svm.get_account(&app).expect("app account must exist");
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
fn test_fund_app_rewards_bumps_accumulator_and_transfers_tokens() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint, pdas) = setup();

    // A voter must exist first: an empty pool (total_vote_stake == 0) cannot
    // be funded (see `test_fund_app_rewards_rejects_zero_total_stake`).
    let voter = Keypair::new();
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
    let voter_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        voter_token_account,
        vote_mint,
        voter.pubkey(),
        10_000,
    );
    let (position, _bump) = Pubkey::find_program_address(
        &[
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            voter.pubkey().as_ref(),
        ],
        &program_id,
    );
    let total_vote_stake = 1_000u64;
    let ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &voter_token_account,
        &voter.pubkey(),
        total_vote_stake,
    );
    assert!(send(&mut svm, ix, &voter.pubkey(), &[&voter]));

    // The vote's principal already sits in the single global vault, so
    // capture the vault balance here rather than assuming it starts at 0 —
    // unlike the old per-app reward vault, this vault is shared with
    // vote/tag-stake principal.
    let vault_before_funding = fetch_token_amount(&svm, pdas.vault);
    assert_eq!(vault_before_funding, total_vote_stake);

    // Fund the vote pool with 500 real tokens from the deployer (who is
    // `Config.authority`).
    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        vote_mint,
        deployer.pubkey(),
        20_000,
    );

    let fund_amount = 500u64;
    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Vote,
        fund_amount,
    );
    let res_ok = send(&mut svm, ix, &deployer.pubkey(), &[&deployer]);
    assert!(res_ok, "fund_app_rewards transaction failed");

    // Tokens actually moved: vault gained `fund_amount` on top of the
    // pre-existing principal, funder lost it.
    assert_eq!(
        fetch_token_amount(&svm, pdas.vault),
        vault_before_funding + fund_amount
    );
    assert_eq!(
        fetch_token_amount(&svm, funder_token_account),
        20_000 - fund_amount
    );

    // Accumulator bumped by exactly fund_amount * PRECISION / total_vote_stake.
    let app_account = fetch_app(&svm, pdas.app);
    let expected_delta = (fund_amount as u128) * REWARD_PRECISION / total_vote_stake as u128;
    assert_eq!(app_account.vote_acc_reward_per_share, expected_delta);
    // The tags pool must be untouched by a Vote-pool funding call.
    assert_eq!(app_account.tags_acc_reward_per_share, 0);
}

#[test]
fn test_fund_app_rewards_rejects_non_authority_signer() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint, pdas) = setup();

    // Stake something so the ONLY possible failure reason is the authority
    // mismatch, not `NoStakers`.
    let voter = Keypair::new();
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
    let voter_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        voter_token_account,
        vote_mint,
        voter.pubkey(),
        10_000,
    );
    let (position, _bump) = Pubkey::find_program_address(
        &[
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            voter.pubkey().as_ref(),
        ],
        &program_id,
    );
    let ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &voter_token_account,
        &voter.pubkey(),
        1_000,
    );
    assert!(send(&mut svm, ix, &voter.pubkey(), &[&voter]));
    let vault_before = fetch_token_amount(&svm, pdas.vault);

    // A stranger, unrelated to `Config.authority`, tries to fund the pool.
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let stranger_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        stranger_token_account,
        vote_mint,
        stranger.pubkey(),
        20_000,
    );

    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &stranger_token_account,
        &stranger.pubkey(),
        RewardPool::Vote,
        500,
    );
    let ok = send(&mut svm, ix, &stranger.pubkey(), &[&stranger]);
    assert!(
        !ok,
        "expected fund_app_rewards to reject a non-authority signer, but it succeeded"
    );

    // Nothing moved.
    assert_eq!(fetch_token_amount(&svm, pdas.vault), vault_before);
    assert_eq!(fetch_token_amount(&svm, stranger_token_account), 20_000);
}

#[test]
fn test_fund_app_rewards_rejects_zero_total_stake() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint, pdas) = setup();

    // Nobody has ever voted: total_vote_stake == 0.
    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        vote_mint,
        deployer.pubkey(),
        20_000,
    );

    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Vote,
        500,
    );
    let ok = send(&mut svm, ix, &deployer.pubkey(), &[&deployer]);
    assert!(
        !ok,
        "expected fund_app_rewards to reject funding an empty pool, but it succeeded"
    );
    assert_eq!(fetch_token_amount(&svm, funder_token_account), 20_000);
}

#[test]
fn test_fund_app_rewards_rejects_zero_total_stake_tags_pool() {
    // Nobody has staked any tag for this app yet (`stake_tag` was never
    // called), so `total_tag_stake` is still 0 — this documents/locks in
    // that a Tags-pool funding attempt correctly hits the same `NoStakers`
    // guard as the vote pool.
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint, pdas) = setup();

    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        vote_mint,
        deployer.pubkey(),
        20_000,
    );

    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Tags,
        500,
    );
    let ok = send(&mut svm, ix, &deployer.pubkey(), &[&deployer]);
    assert!(
        !ok,
        "expected fund_app_rewards to reject funding an empty tags pool, but it succeeded"
    );
}

#[test]
fn test_fund_app_rewards_rejects_zero_amount() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint, pdas) = setup();

    let voter = Keypair::new();
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
    let voter_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        voter_token_account,
        vote_mint,
        voter.pubkey(),
        10_000,
    );
    let (position, _bump) = Pubkey::find_program_address(
        &[
            VOTE_POSITION_SEED,
            pdas.app.as_ref(),
            voter.pubkey().as_ref(),
        ],
        &program_id,
    );
    let ix = vote_ix(
        &program_id,
        &pdas,
        &position,
        &voter_token_account,
        &voter.pubkey(),
        1_000,
    );
    assert!(send(&mut svm, ix, &voter.pubkey(), &[&voter]));

    let funder_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        funder_token_account,
        vote_mint,
        deployer.pubkey(),
        20_000,
    );

    let ix = fund_app_rewards_ix(
        &program_id,
        &pdas,
        &funder_token_account,
        &deployer.pubkey(),
        RewardPool::Vote,
        0,
    );
    let ok = send(&mut svm, ix, &deployer.pubkey(), &[&deployer]);
    assert!(
        !ok,
        "expected fund_app_rewards to reject a zero amount, but it succeeded"
    );
}
