import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { randomBytes } from "crypto";
import { NebulousWorld } from "../target/types/nebulous_world";

// The BPF Upgradeable Loader program owns every upgradeable program's
// `ProgramData` PDA (seeds = [programId], program = BPF_LOADER_UPGRADEABLE).
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

// Mirrors programs/nebulous_world/src/constants.rs's UNSTAKE_FEE_START_BPS —
// the ceiling the unstake fee (see unstake_fee.rs) can never exceed. The
// withdraw_vote/withdraw_tag_stake tests below can't assume "elapsed ~= 0"
// (unlike the Rust/LiteSVM tests, which fully control the clock — see
// test_withdraw_vote.rs): a fresh, single-node local validator's Clock
// sysvar can jump non-monotonically relative to wall-clock/RPC timing early
// in its life, with no other validators' vote timestamps to smooth the
// estimate against. So instead of predicting the fee from an assumed
// elapsed time, these tests derive the ACTUAL fee the program charged from
// the observed vault outflow, then check that the SAME fee is what got
// funded into the reward-per-share accumulator — the invariant this
// instruction must uphold regardless of what the fee bps happened to be at
// the moment it ran.
const UNSTAKE_FEE_START_BPS = 100;

/**
 * `Config` is a singleton PDA that can only be initialized once per test
 * run. Since ts-mocha runs root `describe`s sequentially in file order, an
 * earlier describe block may have already initialized it — reuse its
 * `voteMint`/vault in that case instead of trying (and failing) to
 * `initialize` again. Falls back to initializing it otherwise, so each
 * describe block using this is also runnable in isolation (e.g. `mocha
 * --grep`).
 */
async function ensureConfig(
  program: Program<NebulousWorld>,
  provider: anchor.AnchorProvider,
  configPda: PublicKey,
): Promise<{ voteMint: PublicKey; vault: PublicKey }> {
  try {
    const config = await program.account.config.fetch(configPda);
    return {
      voteMint: config.voteMint,
      vault: getAssociatedTokenAddressSync(config.voteMint, configPda, true),
    };
  } catch {
    // Config not initialized yet — fall through and initialize it.
  }

  const voteMint = await createMint(
    provider.connection,
    (provider.wallet as any).payer,
    provider.wallet.publicKey,
    null,
    6,
  );
  const vault = getAssociatedTokenAddressSync(voteMint, configPda, true);
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );
  await program.methods
    .initialize(1000)
    .accounts({
      config: configPda,
      vault,
      authority: provider.wallet.publicKey,
      voteMint,
      programData: programDataPda,
    })
    .rpc();
  return { voteMint, vault };
}

describe("nebulous_world: config", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  it("initializes the global config and its single global vault", async () => {
    const mint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    // The single global vault: an Associated Token Account owned by the
    // `config` PDA (allowOwnerOffCurve = true, since `config` is a PDA, not
    // a normal wallet). Every instruction that ever moves tokens — vote
    // stake, tag stake, vote rewards, tags rewards — transfers through this
    // one account. See the design note on `Config`.
    const vault = getAssociatedTokenAddressSync(mint, configPda, true);

    // Only the program's upgrade authority (the wallet that deployed it) may
    // call `initialize` — this is what closes the front-running window.
    await program.methods
      .initialize(1000) // 10% protocol fee, in bps
      .accounts({
        config: configPda,
        vault,
        authority: provider.wallet.publicKey,
        voteMint: mint,
        programData: programDataPda,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.protocolFeeBps, 1000);
    assert.isTrue(config.voteMint.equals(mint));
    assert.isTrue(config.authority.equals(provider.wallet.publicKey));

    const vaultAccount = await getAccount(provider.connection, vault);
    assert.isTrue(vaultAccount.mint.equals(mint));
    assert.isTrue(vaultAccount.owner.equals(configPda));
    assert.equal(vaultAccount.amount.toString(), "0");
  });
});

describe("nebulous_world: init_app", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // `Config` is a singleton PDA that can only be initialized once per test
  // run. The "nebulous_world: config" describe block above (which mocha always runs
  // to completion before this one, since ts-mocha executes root `describe`s
  // sequentially in file order) already initializes it — reuse its
  // `voteMint` here instead of trying (and failing) to `initialize` again.
  // Fall back to initializing it ourselves so this block is also runnable in
  // isolation (e.g. `mocha --grep`). Note that `init_app` itself never
  // references `Config`/a vote mint at all (see `init_app.rs`) — this is
  // purely to guarantee `Config` exists for later describe blocks in this
  // file that do need it.
  before(async () => {
    ({ voteMint } = await ensureConfig(program, provider, configPda));
  });

  function derivePda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  it("registers a new app, permissionlessly", async () => {
    // A Prisma cuid-shaped id (~25 chars), randomized to avoid colliding
    // with a previous run against a persisted local validator ledger.
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = derivePda(appId);

    // No authority/signer-identity accounts are passed beyond the payer —
    // `init_app` is permissionless by design (anyone can register any app).
    // Note there's no vault/mint/config account either: `AppAccount` no
    // longer owns any vaults of its own — every app shares the single
    // global vault documented on `Config` — so registering a new app costs
    // no token-account rent at all.
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.appId, appId);
    assert.equal(appAccount.totalVoteStake.toString(), "0");
    assert.equal(appAccount.voteAccRewardPerShare.toString(), "0");
    assert.equal(appAccount.totalTagStake.toString(), "0");
    assert.equal(appAccount.tagsAccRewardPerShare.toString(), "0");
  });

  it("lets a different, unrelated payer register an app (no authority gating)", async () => {
    const strangerPayer = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        strangerPayer.publicKey,
        1_000_000_000,
      ),
    );

    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = derivePda(appId);

    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: strangerPayer.publicKey,
      })
      .signers([strangerPayer])
      .rpc();

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.appId, appId);
  });

  it("rejects an app_id longer than 32 bytes", async () => {
    // A 33-byte app_id exceeds Solana's 32-byte-per-seed limit. Note that
    // `PublicKey.findProgramAddressSync` (client-side, @solana/web3.js)
    // enforces the same limit and throws before a transaction is even
    // built — mirroring the on-chain `Pubkey::find_program_address` panic
    // documented in `init_app.rs`. Either way, an oversized app_id can never
    // successfully register.
    const appId = "a".repeat(33);

    let threw = false;
    try {
      const app = derivePda(appId);
      await program.methods
        .initApp(appId, "example.com/app")
        .accounts({
          app,
          payer: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err) {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected init_app to reject an app_id longer than 32 bytes",
    );
  });
});

describe("nebulous_world: suggest_tag", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the "nebulous_world: init_app" describe
  // block above: `Config` is a singleton, so reuse it if a prior describe
  // block in this file already created it. Like `init_app`, `suggest_tag`
  // never references `Config`/a vote mint either (see `suggest_tag.rs`).
  before(async () => {
    ({ voteMint } = await ensureConfig(program, provider, configPda));
  });

  function deriveAppPda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  // The GLOBAL `Tag` PDA: seeded ONLY by `tagId`, with no `app` in the
  // derivation — every app that suggests the same `tagId` string resolves
  // to this exact same address. See the design note on `Tag`.
  function deriveTagPda(tagId: string) {
    const [tag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), Buffer.from(tagId)],
      program.programId,
    );
    return tag;
  }

  // The per-(app, tag) stake-accounting PDA: seeded by `app.key()` and
  // `tag.key()` (the `Tag` account's own pubkey, not the raw tag_id string).
  function deriveAppTagStakePda(app: PublicKey, tag: PublicKey) {
    const [appTagStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("app_tag_stake"), app.toBuffer(), tag.toBuffer()],
      program.programId,
    );
    return appTagStake;
  }

  async function registerApp() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = deriveAppPda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app };
  }

  it("registers a new tag and its stake-accounting record, permissionlessly", async () => {
    const { appId, app } = await registerApp();
    const tagId = "defi";
    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);

    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tagAccount = await program.account.tag.fetch(tag);
    assert.equal(tagAccount.tagId, tagId);

    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.isTrue(appTagStakeAccount.app.equals(app));
    assert.isTrue(appTagStakeAccount.tag.equals(tag));
    assert.equal(appTagStakeAccount.stakeAmount.toString(), "0");
  });

  it("lets a different, unrelated payer suggest a tag (no authority gating)", async () => {
    const { appId, app } = await registerApp();
    const tagId = "gaming";
    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);

    const strangerPayer = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        strangerPayer.publicKey,
        1_000_000_000,
      ),
    );

    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: strangerPayer.publicKey,
      })
      .signers([strangerPayer])
      .rpc();

    const tagAccount = await program.account.tag.fetch(tag);
    assert.equal(tagAccount.tagId, tagId);
  });

  it("rejects suggesting the same tag_id twice for the same app", async () => {
    const { appId, app } = await registerApp();
    const tagId = "defi";
    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);

    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    // `tag` is `init_if_needed` and would happily be reused, but
    // `app_tag_stake` is a plain `init` — the same app suggesting the same
    // tag twice must fail on that account already existing.
    let threw = false;
    try {
      await program.methods
        .suggestTag(appId, tagId)
        .accounts({
          app,
          tag,
          appTagStake,
          payer: provider.wallet.publicKey,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected a duplicate suggest_tag for the same (app, tag_id) to fail",
    );
  });

  it("rejects a tag_id longer than 32 bytes", async () => {
    const { appId, app } = await registerApp();
    const tagId = "a".repeat(33);

    let threw = false;
    try {
      const tag = deriveTagPda(tagId);
      const appTagStake = deriveAppTagStakePda(app, tag);
      await program.methods
        .suggestTag(appId, tagId)
        .accounts({
          app,
          tag,
          appTagStake,
          payer: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err) {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected suggest_tag to reject a tag_id longer than 32 bytes",
    );
  });

  // The core new behavior of the two-account split (see the design note on
  // `Tag`/`AppTagStake`): the SAME tag_id string suggested by two DIFFERENT
  // apps now resolves to the exact SAME global `Tag` account, while each app
  // still gets its OWN `AppTagStake` record. This replaces the old
  // (pre-refactor) "no collision" test, which asserted the opposite — that
  // the two apps' tag accounts were different — back when a single
  // `AppTagAccount` was seeded by both `app` and `tag_id` together.
  it("shares one global Tag across two different apps' suggestions, with separate AppTagStake records", async () => {
    const { appId: appIdA, app: appA } = await registerApp();
    const { appId: appIdB, app: appB } = await registerApp();
    assert.isFalse(appA.equals(appB));

    const tagId = "defi";
    const tagA = deriveTagPda(tagId);
    const tagB = deriveTagPda(tagId);
    // Same tag_id -> same global Tag PDA, regardless of which app suggests it.
    assert.isTrue(tagA.equals(tagB));
    const tag = tagA;

    const appTagStakeA = deriveAppTagStakePda(appA, tag);
    const appTagStakeB = deriveAppTagStakePda(appB, tag);
    // But the per-(app, tag) stake-accounting PDAs differ, since their seeds
    // include `app.key()`.
    assert.isFalse(appTagStakeA.equals(appTagStakeB));

    await program.methods
      .suggestTag(appIdA, tagId)
      .accounts({
        app: appA,
        tag,
        appTagStake: appTagStakeA,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .suggestTag(appIdB, tagId)
      .accounts({
        app: appB,
        tag,
        appTagStake: appTagStakeB,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    // Exactly one `Tag` account was ever created (app B's suggestion reused
    // it via `init_if_needed`), and both apps' `AppTagStake` accounts point
    // at that identical `Tag` pubkey.
    const tagAccount = await program.account.tag.fetch(tag);
    assert.equal(tagAccount.tagId, tagId);

    const appTagStakeAccountA = await program.account.appTagStake.fetch(
      appTagStakeA,
    );
    const appTagStakeAccountB = await program.account.appTagStake.fetch(
      appTagStakeB,
    );
    assert.isTrue(appTagStakeAccountA.app.equals(appA));
    assert.isTrue(appTagStakeAccountB.app.equals(appB));
    assert.isTrue(appTagStakeAccountA.tag.equals(tag));
    assert.isTrue(appTagStakeAccountB.tag.equals(tag));
  });
});

describe("nebulous_world: vote", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  // Same reuse-or-initialize pattern as the "nebulous_world: init_app" block above:
  // `Config` is a singleton, so reuse it if a prior describe block in this
  // file already created it.
  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function derivePda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function derivePositionPda(app: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerApp() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = derivePda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app };
  }

  it("locks principal, creates a VotePosition, and updates the app's total stake", async () => {
    const { app } = await registerApp();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      10_000,
    );

    const position = derivePositionPda(app, user.publicKey);
    const amount = 4_000;

    // `vault` is now a single GLOBAL account shared by every app/tag/test in
    // this whole file's run against one local validator, so its balance can
    // never be asserted in absolute terms — only as a delta around this
    // specific operation.
    const vaultBefore = await getAccount(provider.connection, vault);

    await program.methods
      .vote(new BN(amount))
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.votePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), amount.toString());
    assert.isTrue(positionAccount.owner.equals(user.publicKey));
    assert.isTrue(positionAccount.app.equals(app));
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalVoteStake.toString(), amount.toString());

    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfter.amount - vaultBefore.amount).toString(),
      amount.toString(),
    );

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(userTokenAfter.amount.toString(), (10_000 - amount).toString());
  });

  it("rejects a zero-amount vote", async () => {
    const { app } = await registerApp();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );

    const position = derivePositionPda(app, user.publicKey);

    let threw = false;
    try {
      await program.methods
        .vote(new BN(0))
        .accounts({
          app,
          position,
          config: configPda,
          vault,
          userTokenAccount: userTokenAccount.address,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected vote to reject a zero amount");
  });
});

describe("nebulous_world: withdraw_vote", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  // Same reuse-or-initialize pattern as the "nebulous_world: vote" describe block
  // above: `Config` is a singleton, so reuse it if a prior describe block in
  // this file already created it.
  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function derivePda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function derivePositionPda(app: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerApp() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = derivePda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app };
  }

  // Registers a fresh app, funds a fresh user's wallet, and votes
  // `initialStake` in to create a `VotePosition` — the common fixture every
  // `withdraw_vote` test below builds on.
  async function setupWithPosition(initialStake: number, walletAmount: number) {
    const { app } = await registerApp();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const position = derivePositionPda(app, user.publicKey);

    await program.methods
      .vote(new BN(initialStake))
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("returns principal and zeroes the position on a full withdrawal", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const vaultBefore = await getAccount(provider.connection, vault);

    await program.methods
      .withdrawVote(new BN(initialStake))
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.votePosition.fetch(position);
    assert.equal(positionAccount.amount.toString(), "0");
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalVoteStake.toString(), "0");
    // This withdrawal empties the vote pool (the fixture's user is the only
    // staker), so the unstake fee is waived rather than funded into an
    // accumulator nobody remains to claim from — see withdraw_vote.rs.
    assert.equal(appAccount.voteAccRewardPerShare.toString(), "0");

    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultBefore.amount - vaultAfter.amount).toString(),
      initialStake.toString(),
    );

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    assert.equal(userTokenAfter.amount.toString(), walletAmount.toString());
  });

  it("leaves remaining stake on a partial withdrawal, net of the unstake fee", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const vaultBefore = await getAccount(provider.connection, vault);

    const withdrawAmount = 1_500;
    await program.methods
      .withdrawVote(new BN(withdrawAmount))
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // `amount`/`total_vote_stake` move by the FULL withdrawAmount; only the
    // token PAYOUT is net of the fee (derived below from the observed vault
    // outflow — see the top-of-file comment on why this test can't assume
    // "elapsed ~= 0" the way the LiteSVM-backed Rust tests can).
    const remainingStake = initialStake - withdrawAmount;

    const vaultAfter = await getAccount(provider.connection, vault);
    const netWithdrawAmount = Number(vaultBefore.amount - vaultAfter.amount);
    const fee = withdrawAmount - netWithdrawAmount;
    assert.isAtLeast(fee, 0, "fee must not be negative");
    assert.isAtMost(
      fee,
      Math.floor((withdrawAmount * UNSTAKE_FEE_START_BPS) / 10_000),
      "fee must never exceed the 1% starting rate",
    );
    const rewardPrecision = new BN("1000000000000");
    const expectedAcc =
      fee > 0
        ? new BN(fee).mul(rewardPrecision).div(new BN(remainingStake))
        : new BN(0);

    const positionAccount = await program.account.votePosition.fetch(position);
    assert.equal(positionAccount.amount.toString(), remainingStake.toString());
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalVoteStake.toString(), remainingStake.toString());
    // The fee actually withheld from the payout (above) must be exactly
    // what got funded into the accumulator — the invariant this instruction
    // must uphold no matter what the fee bps was at the moment it ran.
    assert.equal(appAccount.voteAccRewardPerShare.toString(), expectedAcc.toString());

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - initialStake + netWithdrawAmount).toString(),
    );
  });

  it("rejects a zero-amount withdrawal", async () => {
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(4_000, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawVote(new BN(0))
        .accounts({
          app,
          position,
          config: configPda,
          vault,
          userTokenAccount,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected withdraw_vote to reject a zero amount");
  });

  it("rejects a withdrawal exceeding the position's staked amount", async () => {
    const initialStake = 4_000;
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawVote(new BN(initialStake + 1))
        .accounts({
          app,
          position,
          config: configPda,
          vault,
          userTokenAccount,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected withdraw_vote to reject an over-withdrawal",
    );

    // Nothing moved: the position is untouched.
    const positionAccount = await program.account.votePosition.fetch(position);
    assert.equal(positionAccount.amount.toString(), initialStake.toString());
  });
});

describe("nebulous_world: fund_app_rewards + claim_vote_reward", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  // Same reuse-or-initialize pattern as the other describe blocks above:
  // `Config` is a singleton, so reuse it (and its `authority`, the
  // `provider.wallet` deployer) if a prior describe block already created
  // it.
  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function derivePda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function derivePositionPda(app: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerApp() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = derivePda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app };
  }

  // Registers a fresh app, funds a fresh user's wallet, and votes `stake`
  // in to create a `VotePosition` — the common fixture every test below
  // builds on.
  async function setupWithPosition(stake: number, walletAmount: number) {
    const { app } = await registerApp();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const position = derivePositionPda(app, user.publicKey);

    await program.methods
      .vote(new BN(stake))
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("bumps the vote-pool accumulator and transfers real tokens into the vault", async () => {
    const stake = 1_000;
    const { app } = await setupWithPosition(stake, 10_000);

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      20_000,
    );
    const funderBefore = await getAccount(
      provider.connection,
      funderTokenAccount.address,
    );
    const vaultBefore = await getAccount(provider.connection, vault);

    const fundAmount = 500;
    await program.methods
      .fundAppRewards({ vote: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfter.amount - vaultBefore.amount).toString(),
      fundAmount.toString(),
    );

    const funderAfter = await getAccount(
      provider.connection,
      funderTokenAccount.address,
    );
    assert.equal(
      funderAfter.amount.toString(),
      (funderBefore.amount - BigInt(fundAmount)).toString(),
    );

    const appAccount = await program.account.appAccount.fetch(app);
    // acc = fundAmount * PRECISION / stake = 500 * 1e12 / 1_000 = 5e11.
    assert.equal(
      appAccount.voteAccRewardPerShare.toString(),
      new BN(fundAmount).mul(new BN(10).pow(new BN(12))).div(new BN(stake)).toString(),
    );
  });

  it("rejects a non-authority signer", async () => {
    const { app } = await setupWithPosition(1_000, 10_000);

    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        stranger.publicKey,
        1_000_000_000,
      ),
    );
    const strangerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      stranger.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      strangerTokenAccount.address,
      provider.wallet.publicKey,
      20_000,
    );

    let threw = false;
    try {
      await program.methods
        .fundAppRewards({ vote: {} }, new BN(500))
        .accounts({
          app,
          config: configPda,
          vault,
          funderTokenAccount: strangerTokenAccount.address,
          authority: stranger.publicKey,
        })
        .signers([stranger])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected fund_app_rewards to reject a non-authority signer",
    );
  });

  it("rejects funding a pool with zero total stake", async () => {
    const { app } = await registerApp();

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      20_000,
    );

    let threw = false;
    try {
      await program.methods
        .fundAppRewards({ vote: {} }, new BN(500))
        .accounts({
          app,
          config: configPda,
          vault,
          funderTokenAccount: funderTokenAccount.address,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected fund_app_rewards to reject funding a pool with no stakers",
    );
  });

  it("pays out the pending reward on claim and leaves principal untouched", async () => {
    const stake = 1_000;
    const walletAmount = 10_000;
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(stake, walletAmount);

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    const fundAmount = 2_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      fundAmount,
    );
    await program.methods
      .fundAppRewards({ vote: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (the entire
    // funded amount, since this user holds 100% of the stake).
    const expectedPending = fundAmount;

    const vaultBeforeClaim = await getAccount(provider.connection, vault);

    await program.methods
      .claimVoteReward()
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.votePosition.fetch(position);
    assert.equal(positionAccount.amount.toString(), stake.toString());

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - stake + expectedPending).toString(),
    );

    // The vault paid out exactly the pending reward. Principal is untouched
    // — proven by `positionAccount.amount` above, since the vault is now a
    // single shared pool and its balance alone can no longer separate
    // principal from rewards the way two dedicated vaults once could.
    const vaultAfterClaim = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultBeforeClaim.amount - vaultAfterClaim.amount).toString(),
      expectedPending.toString(),
    );
  });

  it("pays nothing extra on a second claim with no intervening vote/fund", async () => {
    const stake = 1_000;
    const walletAmount = 10_000;
    const { app, user, userTokenAccount, position } =
      await setupWithPosition(stake, walletAmount);

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    const fundAmount = 2_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      fundAmount,
    );
    await program.methods
      .fundAppRewards({ vote: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .claimVoteReward()
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const balanceAfterFirstClaim = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;
    const positionAfterFirstClaim = await program.account.votePosition.fetch(
      position,
    );

    // Claim again immediately — nothing new has accrued.
    await program.methods
      .claimVoteReward()
      .accounts({
        app,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const balanceAfterSecondClaim = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;
    assert.equal(
      balanceAfterSecondClaim.toString(),
      balanceAfterFirstClaim.toString(),
    );

    const positionAfterSecondClaim = await program.account.votePosition.fetch(
      position,
    );
    assert.equal(
      positionAfterSecondClaim.amount.toString(),
      positionAfterFirstClaim.amount.toString(),
    );
    assert.equal(
      positionAfterSecondClaim.rewardDebt.toString(),
      positionAfterFirstClaim.rewardDebt.toString(),
    );
  });
});

describe("nebulous_world: stake_tag", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  // Same reuse-or-initialize pattern as the other describe blocks above:
  // `Config` is a singleton, so reuse it if a prior describe block in this
  // file already created it.
  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function deriveAppPda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function deriveTagPda(tagId: string) {
    const [tag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), Buffer.from(tagId)],
      program.programId,
    );
    return tag;
  }

  function deriveAppTagStakePda(app: PublicKey, tag: PublicKey) {
    const [appTagStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("app_tag_stake"), app.toBuffer(), tag.toBuffer()],
      program.programId,
    );
    return appTagStake;
  }

  function derivePositionPda(appTagStake: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pos"), appTagStake.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  // Registers a fresh app and suggests a fresh tag on it — the common
  // fixture every `stake_tag` test below builds on.
  async function registerAppAndTag(tagId: string = "defi") {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = deriveAppPda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);
    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    return { appId, app, tag, appTagStake };
  }

  it("locks principal, creates a StakePosition, and updates both stake_amount and total_tag_stake", async () => {
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      10_000,
    );

    const position = derivePositionPda(appTagStake, user.publicKey);
    const amount = 4_000;

    const vaultBefore = await getAccount(provider.connection, vault);

    await program.methods
      .stakeTag(new BN(amount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.owner.toBase58(), user.publicKey.toBase58());
    assert.isTrue(positionAccount.appTagStake.equals(appTagStake));
    assert.equal(positionAccount.amount.toString(), amount.toString());
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    // Both counters moved in lockstep.
    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(appTagStakeAccount.stakeAmount.toString(), amount.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), amount.toString());

    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfter.amount - vaultBefore.amount).toString(),
      amount.toString(),
    );

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(userTokenAfter.amount.toString(), (10_000 - amount).toString());
  });

  it("rejects a zero-amount stake", async () => {
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );

    const position = derivePositionPda(appTagStake, user.publicKey);

    let threw = false;
    try {
      await program.methods
        .stakeTag(new BN(0))
        .accounts({
          app,
          appTagStake,
          position,
          config: configPda,
          vault,
          userTokenAccount: userTokenAccount.address,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected stake_tag to reject a zero amount");
  });

  // Regression test for a critical fund-drain vulnerability: without the
  // `constraint = app_tag_stake.app == app.key()` check on
  // `StakeTag::app_tag_stake`, each of `app`/`app_tag_stake`'s seeds/bump
  // constraints only proves internal self-consistency — neither proves the
  // two accounts belong together. An attacker could permissionlessly create
  // their OWN (app, app_tag_stake) pair, then call `stake_tag` passing
  // THEIR `app_tag_stake` alongside a victim's well-funded `app`, silently
  // crediting the attacker's position against the victim's
  // `totalTagStake`/`tagsAccRewardPerShare` — a permissionless path to
  // draining the single shared vault via the corrupted stake denominator.
  // This test builds exactly that mismatched pair and asserts the call is
  // rejected with `AppTagStakeMismatch` specifically, not merely "some
  // error".
  it("rejects a mismatched (app, appTagStake) pair", async () => {
    const victim = await registerAppAndTag();
    const attacker = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      10_000,
    );

    // Position PDA derived off the attacker's own appTagStake (matching
    // what `stake_tag`'s `position` seeds constraint expects), but the
    // instruction passes the VICTIM's `app`.
    const position = derivePositionPda(attacker.appTagStake, user.publicKey);

    const vaultBefore = await getAccount(provider.connection, vault);

    let errorMessage = "";
    try {
      await program.methods
        .stakeTag(new BN(1_000))
        .accounts({
          app: victim.app,
          appTagStake: attacker.appTagStake,
          position,
          config: configPda,
          vault,
          userTokenAccount: userTokenAccount.address,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch (err) {
      errorMessage = String(err);
    }
    assert.include(
      errorMessage,
      "AppTagStakeMismatch",
      "expected stake_tag to reject a mismatched (app, appTagStake) pair with AppTagStakeMismatch",
    );

    // Nothing moved on the victim's side, and no tokens moved at all.
    const victimAppAccount = await program.account.appAccount.fetch(
      victim.app,
    );
    assert.equal(victimAppAccount.totalTagStake.toString(), "0");
    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal((vaultAfter.amount - vaultBefore.amount).toString(), "0");
  });

  // Exercises the reward-payout CPI leg of `stake_tag()` end-to-end via the
  // REAL `fund_app_rewards` instruction (Tags pool) rather than manually
  // poking account state — the highest-risk path (`config`, the single
  // global vault's only authority, signing a transfer out of the shared
  // vault).
  it("pays out the pending reward from a real fund_app_rewards(Tags) call on a second stake", async () => {
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    const walletAmount = 10_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const position = derivePositionPda(appTagStake, user.publicKey);
    const firstAmount = 1_000;

    const vaultBeforeFirstStake = await getAccount(provider.connection, vault);

    await program.methods
      .stakeTag(new BN(firstAmount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Fund the SHARED Tags pool with real tokens via `fund_app_rewards`.
    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    const fundAmount = 2_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      fundAmount,
    );
    await program.methods
      .fundAppRewards({ tags: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (this user
    // holds 100% of the tag's stake).
    const expectedPending = fundAmount;

    const secondAmount = 500;
    await program.methods
      .stakeTag(new BN(secondAmount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(
      positionAccount.amount.toString(),
      (firstAmount + secondAmount).toString(),
    );

    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(
      appTagStakeAccount.stakeAmount.toString(),
      (firstAmount + secondAmount).toString(),
    );
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(
      appAccount.totalTagStake.toString(),
      (firstAmount + secondAmount).toString(),
    );

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (
        walletAmount -
        firstAmount -
        secondAmount +
        expectedPending
      ).toString(),
    );

    // Net effect on the single global vault: both stakes' principal went
    // IN, and the funded reward pool was paid straight back OUT again in
    // full (this user holds 100% of the tag's stake) — so the vault's net
    // change since before the first stake is exactly the two principal
    // deposits, with the funding and payout legs canceling out.
    const vaultAfterSecondStake = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfterSecondStake.amount - vaultBeforeFirstStake.amount).toString(),
      (firstAmount + secondAmount).toString(),
    );
  });
});

describe("nebulous_world: withdraw_tag_stake", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function deriveAppPda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function deriveTagPda(tagId: string) {
    const [tag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), Buffer.from(tagId)],
      program.programId,
    );
    return tag;
  }

  function deriveAppTagStakePda(app: PublicKey, tag: PublicKey) {
    const [appTagStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("app_tag_stake"), app.toBuffer(), tag.toBuffer()],
      program.programId,
    );
    return appTagStake;
  }

  function derivePositionPda(appTagStake: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pos"), appTagStake.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerAppAndTag(tagId: string = "gaming") {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = deriveAppPda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);
    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    return { appId, app, tag, appTagStake };
  }

  // Registers an app + tag, funds a fresh user's wallet, and stakes
  // `initialStake` in to create a `StakePosition` — the common fixture every
  // `withdraw_tag_stake` test below builds on.
  async function setupWithPosition(initialStake: number, walletAmount: number) {
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const position = derivePositionPda(appTagStake, user.publicKey);

    await program.methods
      .stakeTag(new BN(initialStake))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      appTagStake,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("returns principal and zeroes the position on a full withdrawal", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const vaultBefore = await getAccount(provider.connection, vault);

    await program.methods
      .withdrawTagStake(new BN(initialStake))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), "0");
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(appTagStakeAccount.stakeAmount.toString(), "0");
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), "0");
    // This withdrawal empties the (single, shared) tags pool, so the unstake
    // fee is waived — see withdraw_tag_stake.rs.
    assert.equal(appAccount.tagsAccRewardPerShare.toString(), "0");

    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultBefore.amount - vaultAfter.amount).toString(),
      initialStake.toString(),
    );

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(userTokenAfter.amount.toString(), walletAmount.toString());
  });

  it("leaves remaining stake on a partial withdrawal, net of the unstake fee, keeping stake_amount and total_tag_stake in sync", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const vaultBefore = await getAccount(provider.connection, vault);

    const withdrawAmount = 1_500;
    await program.methods
      .withdrawTagStake(new BN(withdrawAmount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Same self-consistency approach as withdraw_vote's partial-withdrawal
    // test — `amount`/`stake_amount`/`total_tag_stake` still move by the
    // FULL withdrawAmount; only the token payout is net of the fee (derived
    // below from the observed vault outflow).
    const remaining = initialStake - withdrawAmount;

    const vaultAfter = await getAccount(provider.connection, vault);
    const netWithdrawAmount = Number(vaultBefore.amount - vaultAfter.amount);
    const fee = withdrawAmount - netWithdrawAmount;
    assert.isAtLeast(fee, 0, "fee must not be negative");
    assert.isAtMost(
      fee,
      Math.floor((withdrawAmount * UNSTAKE_FEE_START_BPS) / 10_000),
      "fee must never exceed the 1% starting rate",
    );
    const rewardPrecision = new BN("1000000000000");
    const expectedAcc =
      fee > 0
        ? new BN(fee).mul(rewardPrecision).div(new BN(remaining))
        : new BN(0);

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), remaining.toString());

    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(appTagStakeAccount.stakeAmount.toString(), remaining.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), remaining.toString());
    // The fee actually withheld from the payout (above) must be exactly
    // what got funded into the accumulator.
    assert.equal(appAccount.tagsAccRewardPerShare.toString(), expectedAcc.toString());

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - initialStake + netWithdrawAmount).toString(),
    );
  });

  it("rejects a zero-amount withdrawal", async () => {
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupWithPosition(4_000, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawTagStake(new BN(0))
        .accounts({
          app,
          appTagStake,
          position,
          config: configPda,
          vault,
          userTokenAccount,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected withdraw_tag_stake to reject a zero amount");
  });

  it("rejects a withdrawal exceeding the position's staked amount", async () => {
    const initialStake = 4_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawTagStake(new BN(initialStake + 1))
        .accounts({
          app,
          appTagStake,
          position,
          config: configPda,
          vault,
          userTokenAccount,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(
      threw,
      "expected withdraw_tag_stake to reject an over-withdrawal",
    );

    // Nothing moved.
    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), initialStake.toString());
    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(
      appTagStakeAccount.stakeAmount.toString(),
      initialStake.toString(),
    );
  });

  // Regression test for a critical fund-drain vulnerability (see the
  // matching test in the "nebulous_world: stake_tag" block for the full exploit
  // writeup): without the `constraint = app_tag_stake.app == app.key()`
  // check on `WithdrawTagStake::app_tag_stake`, an attacker with their OWN
  // legitimate (app, appTagStake, position) could call `withdraw_tag_stake`
  // passing their own `appTagStake`/`position` alongside a victim's
  // well-funded `app`. The pending-reward leg would then settle against the
  // VICTIM's real `tagsAccRewardPerShare` and pay out of the single shared
  // vault against that corrupted accounting. Asserts the call is rejected
  // with `AppTagStakeMismatch` specifically.
  it("rejects a mismatched (app, appTagStake) pair", async () => {
    const victim = await registerAppAndTag();

    // The attacker's own, entirely independent app + tag, with a
    // legitimate stake already in place under the correctly-matched pair.
    const stakeAmount = 1_000;
    const attacker = await setupWithPosition(stakeAmount, 10_000);

    const vaultBefore = await getAccount(provider.connection, vault);

    let errorMessage = "";
    try {
      await program.methods
        .withdrawTagStake(new BN(stakeAmount))
        .accounts({
          app: victim.app,
          appTagStake: attacker.appTagStake,
          position: attacker.position,
          config: configPda,
          vault,
          userTokenAccount: attacker.userTokenAccount,
          user: attacker.user.publicKey,
        })
        .signers([attacker.user])
        .rpc();
    } catch (err) {
      errorMessage = String(err);
    }
    assert.include(
      errorMessage,
      "AppTagStakeMismatch",
      "expected withdraw_tag_stake to reject a mismatched (app, appTagStake) pair with AppTagStakeMismatch",
    );

    // Nothing moved: the victim's pool, the attacker's own position, and
    // the shared vault are all untouched.
    const victimAppAccount = await program.account.appAccount.fetch(
      victim.app,
    );
    assert.equal(victimAppAccount.totalTagStake.toString(), "0");
    const positionAccount = await program.account.stakePosition.fetch(
      attacker.position,
    );
    assert.equal(positionAccount.amount.toString(), stakeAmount.toString());
    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal((vaultAfter.amount - vaultBefore.amount).toString(), "0");
  });

  // Exercises the reward-payout CPI leg of `withdraw_tag_stake()` end-to-end
  // via a REAL `fund_app_rewards` (Tags pool) call — both the pending-reward
  // payout and the principal return now move through the SAME single global
  // vault, signed by the SAME authority (`config`), unlike the
  // pre-global-vault design where two different PDAs each signed for a
  // different vault.
  it("pays out the pending reward from a real fund_app_rewards(Tags) call on a partial withdrawal", async () => {
    const initialStake = 1_000;
    const walletAmount = 10_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    const fundAmount = 2_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      fundAmount,
    );

    const vaultBeforeFund = await getAccount(provider.connection, vault);

    await program.methods
      .fundAppRewards({ tags: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (this user
    // holds 100% of the tag's stake, which is also 100% of the shared pool
    // since no other tag/app has staked in this test run's isolated apps).
    const expectedPending = fundAmount;

    const vaultBeforeWithdraw = await getAccount(provider.connection, vault);

    const withdrawAmount = 400;
    await program.methods
      .withdrawTagStake(new BN(withdrawAmount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // The pending-reward leg above settles/pays out against the accumulator
    // BEFORE the unstake fee is funded into it (position.reward_debt is
    // checkpointed pre-bump — see withdraw_tag_stake.rs), so `expectedPending`
    // and `positionAccount.rewardDebt` below are unaffected by the fee. The
    // fee itself is derived from the observed vault outflow (this tx moves
    // BOTH the pending reward and the net principal, so subtract out the
    // already-known `expectedPending` leg first) — see the top-of-file
    // comment on why this test can't assume "elapsed ~= 0".
    const remaining = initialStake - withdrawAmount;
    const vaultAfterWithdraw = await getAccount(provider.connection, vault);
    const totalPaidOut = Number(vaultBeforeWithdraw.amount - vaultAfterWithdraw.amount);
    const netWithdrawAmount = totalPaidOut - expectedPending;
    const fee = withdrawAmount - netWithdrawAmount;
    assert.isAtLeast(fee, 0, "fee must not be negative");
    assert.isAtMost(
      fee,
      Math.floor((withdrawAmount * UNSTAKE_FEE_START_BPS) / 10_000),
      "fee must never exceed the 1% starting rate",
    );
    const rewardPrecision = new BN("1000000000000");
    const accBeforeFee = new BN(fundAmount).mul(rewardPrecision).div(new BN(initialStake));
    const expectedAcc =
      fee > 0
        ? accBeforeFee.add(new BN(fee).mul(rewardPrecision).div(new BN(remaining)))
        : accBeforeFee;

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), remaining.toString());
    // reward_debt_for(remaining, 2*PRECISION) = remaining * 2.
    assert.equal(
      positionAccount.rewardDebt.toString(),
      (remaining * 2).toString(),
    );

    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(appTagStakeAccount.stakeAmount.toString(), remaining.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), remaining.toString());
    // The just-charged unstake fee was redistributed into the same shared
    // tags-pool accumulator the fund_app_rewards call above already bumped.
    assert.equal(appAccount.tagsAccRewardPerShare.toString(), expectedAcc.toString());

    // User received the pending reward plus the withdrawn principal, net of
    // the unstake fee.
    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (
        walletAmount -
        initialStake +
        netWithdrawAmount +
        expectedPending
      ).toString(),
    );

    // Net effect on the single global vault since before funding:
    // +fundAmount in, -expectedPending back out (the reward leg),
    // -netWithdrawAmount back out (the principal leg, net of the fee — the
    // fee itself never leaves the vault, it's just re-attributed to the
    // accumulator) — since expectedPending == fundAmount here (100% pool
    // ownership), the fund/reward legs cancel and only the net withdrawn
    // principal is left as a net outflow.
    assert.equal(
      (vaultBeforeFund.amount - vaultAfterWithdraw.amount).toString(),
      netWithdrawAmount.toString(),
    );
  });
});

describe("nebulous_world: claim_tag_reward", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NebulousWorld as Program<NebulousWorld>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;
  let vault: PublicKey;

  before(async () => {
    ({ voteMint, vault } = await ensureConfig(program, provider, configPda));
  });

  function deriveAppPda(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    return app;
  }

  function deriveTagPda(tagId: string) {
    const [tag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), Buffer.from(tagId)],
      program.programId,
    );
    return tag;
  }

  function deriveAppTagStakePda(app: PublicKey, tag: PublicKey) {
    const [appTagStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("app_tag_stake"), app.toBuffer(), tag.toBuffer()],
      program.programId,
    );
    return appTagStake;
  }

  function derivePositionPda(appTagStake: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pos"), appTagStake.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerAppAndTag(tagId: string = "gaming") {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const app = deriveAppPda(appId);
    await program.methods
      .initApp(appId, "example.com/app")
      .accounts({
        app,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tag = deriveTagPda(tagId);
    const appTagStake = deriveAppTagStakePda(app, tag);
    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        tag,
        appTagStake,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    return { appId, app, tag, appTagStake };
  }

  // Registers an app + tag, funds a fresh user's wallet, stakes `stake` in
  // to create a `StakePosition`, then funds the TAGS pool for real via
  // `fund_app_rewards` — the common fixture every test below builds on.
  async function setupStakedAndFunded(
    stake: number,
    walletAmount: number,
    fundAmount: number,
  ) {
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const position = derivePositionPda(appTagStake, user.publicKey);

    await program.methods
      .stakeTag(new BN(stake))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const funderTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      provider.wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      funderTokenAccount.address,
      provider.wallet.publicKey,
      fundAmount,
    );
    await program.methods
      .fundAppRewards({ tags: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        vault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    return {
      app,
      appTagStake,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("pays out the pending reward on claim and leaves principal untouched", async () => {
    const stake = 1_000;
    const walletAmount = 10_000;
    const fundAmount = 2_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupStakedAndFunded(stake, walletAmount, fundAmount);

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (the entire
    // funded amount, since this user holds 100% of the tag's stake).
    const expectedPending = fundAmount;

    const vaultBeforeClaim = await getAccount(provider.connection, vault);

    await program.methods
      .claimTagReward()
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), stake.toString());

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - stake + expectedPending).toString(),
    );

    const vaultAfterClaim = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultBeforeClaim.amount - vaultAfterClaim.amount).toString(),
      expectedPending.toString(),
    );

    // Principal (and app_tag_stake.stake_amount) untouched by a claim.
    const appTagStakeAccount = await program.account.appTagStake.fetch(
      appTagStake,
    );
    assert.equal(appTagStakeAccount.stakeAmount.toString(), stake.toString());
  });

  it("pays nothing extra on a second claim with no intervening stake/fund", async () => {
    const stake = 1_000;
    const walletAmount = 10_000;
    const fundAmount = 2_000;
    const { app, appTagStake, user, userTokenAccount, position } =
      await setupStakedAndFunded(stake, walletAmount, fundAmount);

    await program.methods
      .claimTagReward()
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const balanceAfterFirstClaim = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;
    const positionAfterFirstClaim = await program.account.stakePosition.fetch(
      position,
    );

    // Claim again immediately — nothing new has accrued.
    await program.methods
      .claimTagReward()
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const balanceAfterSecondClaim = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;
    assert.equal(
      balanceAfterSecondClaim.toString(),
      balanceAfterFirstClaim.toString(),
    );

    const positionAfterSecondClaim =
      await program.account.stakePosition.fetch(position);
    assert.equal(
      positionAfterSecondClaim.amount.toString(),
      positionAfterFirstClaim.amount.toString(),
    );
    assert.equal(
      positionAfterSecondClaim.rewardDebt.toString(),
      positionAfterFirstClaim.rewardDebt.toString(),
    );
  });

  it("is a harmless no-op when pending reward is zero", async () => {
    // Stake in via `registerAppAndTag` + `stakeTag`, but never fund the
    // tags pool: pending is genuinely 0.
    const { app, appTagStake } = await registerAppAndTag();

    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    const walletAmount = 10_000;
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      walletAmount,
    );

    const stake = 1_000;
    const position = derivePositionPda(appTagStake, user.publicKey);
    await program.methods
      .stakeTag(new BN(stake))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const vaultBeforeClaim = await getAccount(provider.connection, vault);

    await program.methods
      .claimTagReward()
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), stake.toString());
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - stake).toString(),
    );

    // A zero-pending claim moves no tokens at all.
    const vaultAfterClaim = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfterClaim.amount - vaultBeforeClaim.amount).toString(),
      "0",
    );
  });

  // Regression test for a critical fund-drain vulnerability (see the
  // matching tests in the "nebulous_world: stake_tag" and "nebulous_world: withdraw_tag_stake"
  // blocks for the full exploit writeup): without the
  // `constraint = app_tag_stake.app == app.key()` check on
  // `ClaimTagReward::app_tag_stake`, an attacker with their OWN legitimate
  // (app, appTagStake, position) could call `claim_tag_reward` passing
  // their own `appTagStake`/`position` alongside a victim's well-funded
  // `app`. The claim would then settle against the VICTIM's real
  // `tagsAccRewardPerShare` and pay out of the single shared vault against
  // that corrupted accounting. Asserts the call is rejected with
  // `AppTagStakeMismatch` specifically.
  it("rejects a mismatched (app, appTagStake) pair", async () => {
    const stakeAmount = 1_000;
    const fundAmount = 50_000;
    const victim = await setupStakedAndFunded(stakeAmount, 10_000, fundAmount);

    // The attacker's own, entirely independent app + tag, with a
    // legitimate stake already in place under the correctly-matched pair —
    // no funding needed on the attacker's own pool, since the attacker only
    // cares about draining the VICTIM's vault.
    const { app, appTagStake } = await registerAppAndTag("attacker-tag");
    const user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1_000_000_000),
    );
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      user.publicKey,
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      voteMint,
      userTokenAccount.address,
      provider.wallet.publicKey,
      10_000,
    );
    const position = derivePositionPda(appTagStake, user.publicKey);
    await program.methods
      .stakeTag(new BN(stakeAmount))
      .accounts({
        app,
        appTagStake,
        position,
        config: configPda,
        vault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();
    const attacker = {
      app,
      appTagStake,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };

    // Snapshot the vault only AFTER the attacker's own legitimate stake has
    // landed, so the delta below isolates exactly what the
    // (expected-to-fail) malicious claim attempt itself would have moved.
    const vaultBeforeAttack = await getAccount(provider.connection, vault);

    let errorMessage = "";
    try {
      await program.methods
        .claimTagReward()
        .accounts({
          app: victim.app,
          appTagStake: attacker.appTagStake,
          position: attacker.position,
          config: configPda,
          vault,
          userTokenAccount: attacker.userTokenAccount,
          user: attacker.user.publicKey,
        })
        .signers([attacker.user])
        .rpc();
    } catch (err) {
      errorMessage = String(err);
    }
    assert.include(
      errorMessage,
      "AppTagStakeMismatch",
      "expected claim_tag_reward to reject a mismatched (app, appTagStake) pair with AppTagStakeMismatch",
    );

    // Nothing moved: the failed attempt transferred exactly zero tokens,
    // and the attacker's own position is untouched.
    const vaultAfterAttack = await getAccount(provider.connection, vault);
    assert.equal(
      (vaultAfterAttack.amount - vaultBeforeAttack.amount).toString(),
      "0",
    );
    const positionAccount = await program.account.stakePosition.fetch(
      attacker.position,
    );
    assert.equal(positionAccount.amount.toString(), stakeAmount.toString());
  });
});
