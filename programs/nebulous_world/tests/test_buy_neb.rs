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
    litesvm::LiteSVM,
    nebulous_world::constants::{CONFIG_SEED, NEB_POOL_SEED, NEB_POOL_VAULT_SEED},
    nebulous_world::pool_math::compute_buy_out,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint},
};

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

fn neb_pool_pdas(program_id: &Pubkey) -> (Pubkey, Pubkey) {
    let (pool, _) = Pubkey::find_program_address(&[NEB_POOL_SEED], program_id);
    let (vault, _) =
        Pubkey::find_program_address(&[NEB_POOL_VAULT_SEED, pool.as_ref()], program_id);
    (pool, vault)
}

/// Fresh LiteSVM with the nebulous_world program loaded, `Config` initialized, and a
/// NEB pool already seeded with `total_supply`/`virtual_sol_reserves` —
/// everything `buy_neb` tests need, so each test only has to set up its own
/// buyer.
fn setup(total_supply: u64, virtual_sol_reserves: u64) -> (LiteSVM, Pubkey, Pubkey, Pubkey) {
    let program_id = nebulous_world::id();
    let deployer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/nebulous_world.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&deployer.pubkey(), 10_000_000_000).unwrap();

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

    let (pool, token_vault) = neb_pool_pdas(&program_id);
    let authority_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        authority_token_account,
        vote_mint,
        deployer.pubkey(),
        total_supply,
    );
    let init_pool_ix = Instruction::new_with_bytes(
        program_id,
        &nebulous_world::instruction::InitNebPool {
            total_supply,
            virtual_sol_reserves,
        }
        .data(),
        nebulous_world::accounts::InitNebPool {
            config,
            pool,
            token_vault,
            vote_mint,
            authority_token_account,
            authority: deployer.pubkey(),
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_pool_ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    svm.send_transaction(tx)
        .expect("init_neb_pool must succeed in test setup");

    (svm, vote_mint, pool, token_vault)
}

fn buy_neb_ix(
    program_id: &Pubkey,
    pool: Pubkey,
    token_vault: Pubkey,
    buyer_token_account: Pubkey,
    buyer: Pubkey,
    sol_amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::BuyNeb { sol_amount }.data(),
        nebulous_world::accounts::BuyNeb {
            pool,
            token_vault,
            buyer_token_account,
            buyer,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn get_pool(svm: &LiteSVM, pool: Pubkey) -> nebulous_world::NebPool {
    let raw = svm.get_account(&pool).expect("pool account must exist");
    anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_slice()).unwrap()
}

fn get_token_balance(svm: &LiteSVM, account: Pubkey) -> u64 {
    let raw = svm.get_account(&account).expect("token account must exist");
    SplTokenAccount::unpack(&raw.data).unwrap().amount
}

#[test]
fn test_buy_neb_transfers_sol_pays_out_neb_matching_the_curve() {
    let program_id = nebulous_world::id();
    let total_supply = 1_000_000_000_000u64; // 1,000,000 NEB @ 6 decimals
    let virtual_sol_reserves = 30_000_000_000u64; // 30 SOL
    let (mut svm, vote_mint, pool, token_vault) = setup(total_supply, virtual_sol_reserves);

    let buyer = Keypair::new();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();
    let buyer_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, buyer_token_account, vote_mint, buyer.pubkey(), 0);

    let sol_in = 1_000_000_000u64; // 1 SOL
    let expected_out =
        compute_buy_out(total_supply, total_supply, virtual_sol_reserves, 0, sol_in).unwrap();

    let pool_lamports_before = svm.get_account(&pool).unwrap().lamports;
    let buyer_lamports_before = svm.get_account(&buyer.pubkey()).unwrap().lamports;

    let ix = buy_neb_ix(
        &program_id,
        pool,
        token_vault,
        buyer_token_account,
        buyer.pubkey(),
        sol_in,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&buyer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "buy_neb failed: {:?}", res);

    // NEB landed in the buyer's account, matching the pure curve function exactly.
    assert_eq!(get_token_balance(&svm, buyer_token_account), expected_out);
    assert_eq!(
        get_token_balance(&svm, token_vault),
        total_supply - expected_out
    );

    // Pool state tracks the trade.
    let pool_account = get_pool(&svm, pool);
    assert_eq!(pool_account.remaining_supply, total_supply - expected_out);
    assert_eq!(pool_account.sol_raised, sol_in);

    // Real SOL actually moved: pool gained exactly sol_in, buyer lost at
    // least sol_in (plus a small tx fee).
    let pool_lamports_after = svm.get_account(&pool).unwrap().lamports;
    assert_eq!(pool_lamports_after - pool_lamports_before, sol_in);
    let buyer_lamports_after = svm.get_account(&buyer.pubkey()).unwrap().lamports;
    assert!(buyer_lamports_before - buyer_lamports_after >= sol_in);
}

#[test]
fn test_buy_neb_price_increases_across_sequential_buys() {
    let program_id = nebulous_world::id();
    let total_supply = 1_000_000_000_000u64;
    let virtual_sol_reserves = 30_000_000_000u64;
    let (mut svm, vote_mint, pool, token_vault) = setup(total_supply, virtual_sol_reserves);

    let buyer = Keypair::new();
    svm.airdrop(&buyer.pubkey(), 10_000_000_000).unwrap();
    let buyer_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, buyer_token_account, vote_mint, buyer.pubkey(), 0);

    let sol_in = 1_000_000_000u64; // 1 SOL, bought twice in a row

    let mut received = Vec::new();
    for i in 0..2 {
        if i > 0 {
            // Force a fresh blockhash so the second (otherwise identical)
            // transaction isn't rejected as a duplicate of the first.
            svm.expire_blockhash();
        }
        let before = get_token_balance(&svm, buyer_token_account);
        let ix = buy_neb_ix(
            &program_id,
            pool,
            token_vault,
            buyer_token_account,
            buyer.pubkey(),
            sol_in,
        );
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&buyer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
        let res = svm.send_transaction(tx);
        assert!(res.is_ok(), "buy_neb failed: {:?}", res);
        let after = get_token_balance(&svm, buyer_token_account);
        received.push(after - before);
    }

    assert!(
        received[1] < received[0],
        "second buy ({}) should receive less NEB than the first ({}) — price must rise",
        received[1],
        received[0]
    );
}

#[test]
fn test_buy_neb_rejects_zero_sol_amount() {
    let program_id = nebulous_world::id();
    let (mut svm, vote_mint, pool, token_vault) = setup(1_000_000_000_000, 30_000_000_000);

    let buyer = Keypair::new();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();
    let buyer_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, buyer_token_account, vote_mint, buyer.pubkey(), 0);

    let ix = buy_neb_ix(
        &program_id,
        pool,
        token_vault,
        buyer_token_account,
        buyer.pubkey(),
        0,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&buyer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "expected buy_neb to reject a zero sol_amount");
}

#[test]
fn test_buy_neb_rejects_once_pool_is_fully_sold_out() {
    let program_id = nebulous_world::id();
    // Tiny constants (matching pool_math.rs's own test) so the curve can
    // actually be driven to exactly zero remaining supply within a single
    // realistic-sized lamport buy.
    let total_supply = 100u64;
    let virtual_sol_reserves = 10u64;
    let (mut svm, vote_mint, pool, token_vault) = setup(total_supply, virtual_sol_reserves);

    let buyer = Keypair::new();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();
    let buyer_token_account = Pubkey::new_unique();
    fund_token_account(&mut svm, buyer_token_account, vote_mint, buyer.pubkey(), 0);

    // First buy: large enough to fully deplete remaining_supply (see
    // pool_math.rs's `a_large_enough_buy_sells_out_the_remainder_without_reverting`).
    let ix = buy_neb_ix(
        &program_id,
        pool,
        token_vault,
        buyer_token_account,
        buyer.pubkey(),
        100_000,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&buyer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
    svm.send_transaction(tx)
        .expect("the depleting buy must succeed in test setup");
    assert_eq!(get_pool(&svm, pool).remaining_supply, 0);

    // Second buy: pool is sold out, must be rejected outright.
    let ix2 = buy_neb_ix(
        &program_id,
        pool,
        token_vault,
        buyer_token_account,
        buyer.pubkey(),
        1_000_000,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix2], Some(&buyer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&buyer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected buy_neb to reject a buy against a fully sold-out pool"
    );
}
