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
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint},
};

/// See test_initialize.rs for context: overwrites the nebulous_world program's
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

/// Fresh LiteSVM with the nebulous_world program loaded and `Config` initialized
/// (deployer == Config.authority). No pool yet — each test calls
/// `init_neb_pool` itself so it can vary the args/signer under test.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
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

    (svm, deployer, vote_mint)
}

fn neb_pool_pdas(program_id: &Pubkey) -> (Pubkey, Pubkey) {
    let (pool, _) = Pubkey::find_program_address(&[NEB_POOL_SEED], program_id);
    let (vault, _) =
        Pubkey::find_program_address(&[NEB_POOL_VAULT_SEED, pool.as_ref()], program_id);
    (pool, vault)
}

#[allow(clippy::too_many_arguments)]
fn init_neb_pool_ix(
    program_id: &Pubkey,
    pool: Pubkey,
    token_vault: Pubkey,
    vote_mint: Pubkey,
    authority_token_account: Pubkey,
    authority: Pubkey,
    total_supply: u64,
    virtual_sol_reserves: u64,
) -> Instruction {
    let (config, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    Instruction::new_with_bytes(
        *program_id,
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
            authority,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_init_neb_pool_deposits_supply_and_sets_state() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint) = setup();
    let (pool, token_vault) = neb_pool_pdas(&program_id);

    let authority_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        authority_token_account,
        vote_mint,
        deployer.pubkey(),
        1_000_000,
    );

    let total_supply = 1_000_000u64;
    let virtual_sol_reserves = 30_000_000_000u64;
    let ix = init_neb_pool_ix(
        &program_id,
        pool,
        token_vault,
        vote_mint,
        authority_token_account,
        deployer.pubkey(),
        total_supply,
        virtual_sol_reserves,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&deployer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "init_neb_pool failed: {:?}", res);

    let pool_raw = svm.get_account(&pool).expect("pool account must exist");
    let pool_account: nebulous_world::NebPool =
        anchor_lang::AccountDeserialize::try_deserialize(&mut pool_raw.data.as_slice()).unwrap();
    assert_eq!(pool_account.mint, vote_mint);
    assert_eq!(pool_account.token_vault, token_vault);
    assert_eq!(pool_account.total_supply, total_supply);
    assert_eq!(pool_account.remaining_supply, total_supply);
    assert_eq!(pool_account.sol_raised, 0);
    assert_eq!(pool_account.virtual_sol_reserves, virtual_sol_reserves);

    // The entire supply moved out of the authority's account into the vault
    // (single-sided: no SOL was touched by this instruction at all).
    let vault_raw = svm.get_account(&token_vault).expect("vault must exist");
    let vault_account = SplTokenAccount::unpack(&vault_raw.data).unwrap();
    assert_eq!(vault_account.amount, total_supply);

    let authority_raw = svm
        .get_account(&authority_token_account)
        .expect("authority token account must exist");
    let authority_account = SplTokenAccount::unpack(&authority_raw.data).unwrap();
    assert_eq!(authority_account.amount, 0);
}

#[test]
fn test_init_neb_pool_rejects_non_authority() {
    let program_id = nebulous_world::id();
    let (mut svm, _deployer, vote_mint) = setup();
    let (pool, token_vault) = neb_pool_pdas(&program_id);

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let attacker_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        attacker_token_account,
        vote_mint,
        attacker.pubkey(),
        1_000_000,
    );

    let ix = init_neb_pool_ix(
        &program_id,
        pool,
        token_vault,
        vote_mint,
        attacker_token_account,
        attacker.pubkey(),
        1_000_000,
        30_000_000_000,
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "expected init_neb_pool to reject a non-authority caller, but it succeeded"
    );
}

#[test]
fn test_init_neb_pool_rejects_double_init() {
    let program_id = nebulous_world::id();
    let (mut svm, deployer, vote_mint) = setup();
    let (pool, token_vault) = neb_pool_pdas(&program_id);

    let authority_token_account = Pubkey::new_unique();
    fund_token_account(
        &mut svm,
        authority_token_account,
        vote_mint,
        deployer.pubkey(),
        2_000_000,
    );

    for i in 0..2 {
        let ix = init_neb_pool_ix(
            &program_id,
            pool,
            token_vault,
            vote_mint,
            authority_token_account,
            deployer.pubkey(),
            1_000_000,
            30_000_000_000,
        );
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&deployer.pubkey()), &blockhash);
        let tx =
            VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&deployer]).unwrap();
        let res = svm.send_transaction(tx);
        if i == 0 {
            assert!(res.is_ok(), "first init_neb_pool must succeed: {:?}", res);
        } else {
            assert!(
                res.is_err(),
                "expected the second init_neb_pool call to fail (pool already exists), but it succeeded"
            );
        }
    }
}
