use {
    anchor_lang::solana_program::{pubkey::Pubkey, system_program},
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    nebulous_world::constants::{APP_SEED, APP_TAG_STAKE_SEED, TAG_SEED},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// Sets up a fresh LiteSVM instance with the nebulous_world program loaded
/// and a funded deployer/payer. Neither `init_app` nor `suggest_tag`
/// reference `Config`/a vote mint/any vault at all (see `init_app.rs` and
/// `suggest_tag.rs`), so unlike `test_init_app.rs`'s `setup()` this one
/// skips `initialize()` entirely — spinning up a fake mint and an
/// upgrade-authority-gated `initialize` call here would be unused overhead.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = nebulous_world::id();
    let deployer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/nebulous_world.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&deployer.pubkey(), 1_000_000_000).unwrap();
    (svm, deployer, program_id)
}

fn derive_app(program_id: &Pubkey, app_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[APP_SEED, app_id.as_bytes()], program_id).0
}

/// The GLOBAL `Tag` PDA: seeded ONLY by `tag_id`, with no `app` in the
/// derivation — every app that suggests the same `tag_id` string resolves
/// to this exact same address.
fn derive_tag(program_id: &Pubkey, tag_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[TAG_SEED, tag_id.as_bytes()], program_id).0
}

/// The per-(app, tag) stake-accounting PDA: seeded by `app.key()` and
/// `tag.key()` (the `Tag` account's pubkey, not the raw `tag_id` string).
fn derive_app_tag_stake(program_id: &Pubkey, app: &Pubkey, tag: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[APP_TAG_STAKE_SEED, app.as_ref(), tag.as_ref()],
        program_id,
    )
    .0
}

fn init_app_ix(program_id: &Pubkey, payer: &Pubkey, app_id: &str, app: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::InitApp {
            app_id: app_id.to_string(),
            url: "example.com".to_string(),
        }
        .data(),
        nebulous_world::accounts::InitApp {
            app: *app,
            payer: *payer,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn suggest_tag_ix(
    program_id: &Pubkey,
    payer: &Pubkey,
    app: &Pubkey,
    app_id: &str,
    tag: &Pubkey,
    tag_id: &str,
    app_tag_stake: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        *program_id,
        &nebulous_world::instruction::SuggestTag {
            app_id: app_id.to_string(),
            tag_id: tag_id.to_string(),
        }
        .data(),
        nebulous_world::accounts::SuggestTag {
            app: *app,
            tag: *tag,
            app_tag_stake: *app_tag_stake,
            payer: *payer,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// `FailedTransactionMetadata` is a large struct (>=200 bytes); box it so this
// `Result`'s error variant doesn't bloat every caller's stack frame
// (clippy::result_large_err).
fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ix: Instruction,
) -> Result<(), Box<litesvm::types::FailedTransactionMetadata>> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(Box::new)
}

fn register_app(svm: &mut LiteSVM, program_id: &Pubkey, payer: &Keypair, app_id: &str) -> Pubkey {
    let app = derive_app(program_id, app_id);
    let ix = init_app_ix(program_id, &payer.pubkey(), app_id, &app);
    send(svm, payer, ix).expect("init_app must succeed in test setup");
    app
}

#[test]
fn test_suggest_tag_happy_path() {
    let (mut svm, deployer, program_id) = setup();

    let app_id = "cid_test_app_0000000001".to_string();
    let app = register_app(&mut svm, &program_id, &deployer, &app_id);

    let tag_id = "defi".to_string();
    let tag = derive_tag(&program_id, &tag_id);
    let app_tag_stake = derive_app_tag_stake(&program_id, &app, &tag);
    let ix = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app,
        &app_id,
        &tag,
        &tag_id,
        &app_tag_stake,
    );
    let res = send(&mut svm, &deployer, ix);
    assert!(res.is_ok(), "suggest_tag failed: {:?}", res);

    let tag_raw = svm.get_account(&tag).expect("tag account must exist");
    let tag_account: nebulous_world::Tag =
        anchor_lang::AccountDeserialize::try_deserialize(&mut tag_raw.data.as_slice()).unwrap();
    assert_eq!(tag_account.tag_id, tag_id);

    let stake_raw = svm
        .get_account(&app_tag_stake)
        .expect("app_tag_stake account must exist");
    let stake_account: nebulous_world::AppTagStake =
        anchor_lang::AccountDeserialize::try_deserialize(&mut stake_raw.data.as_slice()).unwrap();
    assert_eq!(stake_account.app, app);
    assert_eq!(stake_account.tag, tag);
    assert_eq!(stake_account.stake_amount, 0);
}

#[test]
fn test_suggest_tag_is_permissionless() {
    let (mut svm, deployer, program_id) = setup();

    let app_id = "cid_test_app_0000000002".to_string();
    let app = register_app(&mut svm, &program_id, &deployer, &app_id);

    // A stranger (not the deployer/upgrade authority) can suggest a tag.
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    let tag_id = "gaming".to_string();
    let tag = derive_tag(&program_id, &tag_id);
    let app_tag_stake = derive_app_tag_stake(&program_id, &app, &tag);
    let ix = suggest_tag_ix(
        &program_id,
        &stranger.pubkey(),
        &app,
        &app_id,
        &tag,
        &tag_id,
        &app_tag_stake,
    );
    let res = send(&mut svm, &stranger, ix);
    assert!(
        res.is_ok(),
        "suggest_tag failed for a stranger payer: {:?}",
        res
    );
}

#[test]
fn test_suggest_tag_rejects_duplicate_tag_for_same_app() {
    let (mut svm, deployer, program_id) = setup();

    let app_id = "cid_test_app_0000000003".to_string();
    let app = register_app(&mut svm, &program_id, &deployer, &app_id);

    let tag_id = "defi".to_string();
    let tag = derive_tag(&program_id, &tag_id);
    let app_tag_stake = derive_app_tag_stake(&program_id, &app, &tag);
    let ix1 = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app,
        &app_id,
        &tag,
        &tag_id,
        &app_tag_stake,
    );
    send(&mut svm, &deployer, ix1).expect("first suggest_tag must succeed");

    // Suggesting the exact same (app, tag_id) pair again must fail cleanly —
    // Anchor's plain `init` constraint on `app_tag_stake` requires the
    // account not already exist. (`tag` itself is `init_if_needed` and would
    // happily be reused; it's `app_tag_stake` that blocks the duplicate.)
    let ix2 = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app,
        &app_id,
        &tag,
        &tag_id,
        &app_tag_stake,
    );
    let res = send(&mut svm, &deployer, ix2);
    assert!(
        res.is_err(),
        "expected a duplicate suggest_tag for the same (app, tag_id) to fail"
    );
}

#[test]
fn test_suggest_tag_rejects_tag_id_over_32_bytes() {
    let (mut svm, deployer, program_id) = setup();

    let app_id = "cid_test_app_0000000004".to_string();
    let app = register_app(&mut svm, &program_id, &deployer, &app_id);

    // 33 bytes exceeds Solana's 32-byte-per-seed limit — mirrors
    // `test_init_app.rs`'s oversized app_id test. We can't derive the "real"
    // PDAs (find_program_address panics client-side too), so pass unrelated
    // pubkeys in those slots; the program's own seed derivation during
    // account resolution panics on the oversized seed regardless.
    let tag_id = "a".repeat(33);
    let tag = Pubkey::new_unique();
    let app_tag_stake = Pubkey::new_unique();
    let ix = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app,
        &app_id,
        &tag,
        &tag_id,
        &app_tag_stake,
    );
    let res = send(&mut svm, &deployer, ix);
    assert!(
        res.is_err(),
        "expected suggest_tag to reject a tag_id longer than 32 bytes"
    );
}

/// The core new behavior of the two-account split: the SAME `tag_id` string
/// suggested by two DIFFERENT apps now resolves to the exact SAME global
/// `Tag` account (since its seeds are `[TAG_SEED, tag_id]`, with no `app`),
/// while each app still gets its OWN `app_tag_stake` account (since those
/// seeds include `app.key()`). This replaces the old (pre-refactor)
/// `..._no_collision` test, which asserted the opposite — that the two apps'
/// tag accounts were different — back when `AppTagAccount` was seeded by
/// both `app` and `tag_id` together.
#[test]
fn test_suggest_tag_same_tag_id_shared_across_apps() {
    let (mut svm, deployer, program_id) = setup();

    let app_id_a = "cid_test_app_aaaaaaaaaaa".to_string();
    let app_id_b = "cid_test_app_bbbbbbbbbbb".to_string();
    let app_a = register_app(&mut svm, &program_id, &deployer, &app_id_a);
    let app_b = register_app(&mut svm, &program_id, &deployer, &app_id_b);
    assert_ne!(app_a, app_b);

    let tag_id = "defi".to_string();
    let tag_a = derive_tag(&program_id, &tag_id);
    let tag_b = derive_tag(&program_id, &tag_id);
    // Same tag_id -> same global Tag PDA, regardless of which app suggests it.
    assert_eq!(tag_a, tag_b);
    let tag = tag_a;

    let app_tag_stake_a = derive_app_tag_stake(&program_id, &app_a, &tag);
    let app_tag_stake_b = derive_app_tag_stake(&program_id, &app_b, &tag);
    // But the per-(app, tag) stake-accounting PDAs differ, since their seeds
    // include `app.key()`.
    assert_ne!(app_tag_stake_a, app_tag_stake_b);

    let ix_a = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app_a,
        &app_id_a,
        &tag,
        &tag_id,
        &app_tag_stake_a,
    );
    let res_a = send(&mut svm, &deployer, ix_a);
    assert!(res_a.is_ok(), "suggest_tag for app A failed: {:?}", res_a);

    let ix_b = suggest_tag_ix(
        &program_id,
        &deployer.pubkey(),
        &app_b,
        &app_id_b,
        &tag,
        &tag_id,
        &app_tag_stake_b,
    );
    let res_b = send(&mut svm, &deployer, ix_b);
    assert!(res_b.is_ok(), "suggest_tag for app B failed: {:?}", res_b);

    // Exactly one `Tag` account was ever created (app B's suggestion reused
    // it via `init_if_needed`), and both apps' `app_tag_stake` accounts
    // point at that identical `Tag` pubkey.
    let tag_raw = svm.get_account(&tag).unwrap();
    let tag_account: nebulous_world::Tag =
        anchor_lang::AccountDeserialize::try_deserialize(&mut tag_raw.data.as_slice()).unwrap();
    assert_eq!(tag_account.tag_id, tag_id);

    let stake_raw_a = svm.get_account(&app_tag_stake_a).unwrap();
    let stake_a: nebulous_world::AppTagStake =
        anchor_lang::AccountDeserialize::try_deserialize(&mut stake_raw_a.data.as_slice())
            .unwrap();
    let stake_raw_b = svm.get_account(&app_tag_stake_b).unwrap();
    let stake_b: nebulous_world::AppTagStake =
        anchor_lang::AccountDeserialize::try_deserialize(&mut stake_raw_b.data.as_slice())
            .unwrap();

    assert_eq!(stake_a.app, app_a);
    assert_eq!(stake_b.app, app_b);
    assert_eq!(stake_a.tag, tag);
    assert_eq!(stake_b.tag, tag);
    assert_ne!(stake_a.app, stake_b.app);
}
