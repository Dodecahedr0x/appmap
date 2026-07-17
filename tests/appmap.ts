import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { randomBytes } from "crypto";
import { Appmap } from "../target/types/appmap";

// The BPF Upgradeable Loader program owns every upgradeable program's
// `ProgramData` PDA (seeds = [programId], program = BPF_LOADER_UPGRADEABLE).
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

describe("appmap: config", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  it("initializes the global config", async () => {
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

    // Only the program's upgrade authority (the wallet that deployed it) may
    // call `initialize` — this is what closes the front-running window.
    await program.methods
      .initialize(1000) // 10% protocol fee, in bps
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint: mint,
        programData: programDataPda,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.protocolFeeBps, 1000);
    assert.isTrue(config.voteMint.equals(mint));
    assert.isTrue(config.authority.equals(provider.wallet.publicKey));
  });
});

describe("appmap: init_app", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // `Config` is a singleton PDA that can only be initialized once per test
  // run. The "appmap: config" describe block above (which mocha always runs
  // to completion before this one, since ts-mocha executes root `describe`s
  // sequentially in file order) already initializes it — reuse its
  // `voteMint` here instead of trying (and failing) to `initialize` again.
  // Fall back to initializing it ourselves so this block is also runnable in
  // isolation (e.g. `mocha --grep`).
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
  }

  it("registers a new app and its three vaults, permissionlessly", async () => {
    // A Prisma cuid-shaped id (~25 chars), randomized to avoid colliding
    // with a previous run against a persisted local validator ledger.
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);

    // No authority/signer-identity accounts are passed beyond the payer —
    // `init_app` is permissionless by design (anyone can register any app).
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.appId, appId);
    assert.isTrue(appAccount.voteVault.equals(voteVault));
    assert.isTrue(appAccount.voteRewardVault.equals(voteRewardVault));
    assert.isTrue(appAccount.tagsRewardVault.equals(tagsRewardVault));
    assert.equal(appAccount.totalVoteStake.toString(), "0");
    assert.equal(appAccount.voteAccRewardPerShare.toString(), "0");
    assert.equal(appAccount.totalTagStake.toString(), "0");
    assert.equal(appAccount.tagsAccRewardPerShare.toString(), "0");

    for (const vault of [voteVault, voteRewardVault, tagsRewardVault]) {
      const account = await getAccount(provider.connection, vault);
      assert.isTrue(account.mint.equals(voteMint));
      assert.isTrue(account.owner.equals(app));
      assert.equal(account.amount.toString(), "0");
    }
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
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);

    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
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
      const { app, voteVault, voteRewardVault, tagsRewardVault } =
        derivePdas(appId);
      await program.methods
        .initApp(appId)
        .accounts({
          app,
          config: configPda,
          voteVault,
          voteRewardVault,
          tagsRewardVault,
          voteMint,
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

describe("appmap: suggest_tag", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the "appmap: init_app" describe
  // block above: `Config` is a singleton, so reuse it if a prior describe
  // block in this file already created it.
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function deriveAppPdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
  }

  function deriveTagPdas(app: PublicKey, tagId: string) {
    const [appTag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), app.toBuffer(), Buffer.from(tagId)],
      program.programId,
    );
    const [principalVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag_vault"), appTag.toBuffer()],
      program.programId,
    );
    return { appTag, principalVault };
  }

  async function registerApp() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      deriveAppPdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app };
  }

  it("registers a new tag and its principal vault, permissionlessly", async () => {
    const { appId, app } = await registerApp();
    const tagId = "defi";
    const { appTag, principalVault } = deriveTagPdas(app, tagId);

    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        appTag,
        config: configPda,
        principalVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.isTrue(appTagAccount.app.equals(app));
    assert.equal(appTagAccount.tagId, tagId);
    assert.isTrue(appTagAccount.principalVault.equals(principalVault));
    assert.equal(appTagAccount.stakeAmount.toString(), "0");

    const vaultAccount = await getAccount(provider.connection, principalVault);
    assert.isTrue(vaultAccount.mint.equals(voteMint));
    assert.isTrue(vaultAccount.owner.equals(appTag));
    assert.equal(vaultAccount.amount.toString(), "0");
  });

  it("lets a different, unrelated payer suggest a tag (no authority gating)", async () => {
    const { appId, app } = await registerApp();
    const tagId = "gaming";
    const { appTag, principalVault } = deriveTagPdas(app, tagId);

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
        appTag,
        config: configPda,
        principalVault,
        voteMint,
        payer: strangerPayer.publicKey,
      })
      .signers([strangerPayer])
      .rpc();

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(appTagAccount.tagId, tagId);
  });

  it("rejects suggesting the same tag_id twice for the same app", async () => {
    const { appId, app } = await registerApp();
    const tagId = "defi";
    const { appTag, principalVault } = deriveTagPdas(app, tagId);

    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        appTag,
        config: configPda,
        principalVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    let threw = false;
    try {
      await program.methods
        .suggestTag(appId, tagId)
        .accounts({
          app,
          appTag,
          config: configPda,
          principalVault,
          voteMint,
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
      const { appTag, principalVault } = deriveTagPdas(app, tagId);
      await program.methods
        .suggestTag(appId, tagId)
        .accounts({
          app,
          appTag,
          config: configPda,
          principalVault,
          voteMint,
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

  it("allows the same tag_id to be suggested for two different apps without collision", async () => {
    const { appId: appIdA, app: appA } = await registerApp();
    const { appId: appIdB, app: appB } = await registerApp();
    assert.isFalse(appA.equals(appB));

    const tagId = "defi";
    const { appTag: appTagA, principalVault: principalVaultA } =
      deriveTagPdas(appA, tagId);
    const { appTag: appTagB, principalVault: principalVaultB } =
      deriveTagPdas(appB, tagId);
    assert.isFalse(appTagA.equals(appTagB));

    await program.methods
      .suggestTag(appIdA, tagId)
      .accounts({
        app: appA,
        appTag: appTagA,
        config: configPda,
        principalVault: principalVaultA,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .suggestTag(appIdB, tagId)
      .accounts({
        app: appB,
        appTag: appTagB,
        config: configPda,
        principalVault: principalVaultB,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const appTagAccountA = await program.account.appTagAccount.fetch(appTagA);
    const appTagAccountB = await program.account.appTagAccount.fetch(appTagB);
    assert.isTrue(appTagAccountA.app.equals(appA));
    assert.isTrue(appTagAccountB.app.equals(appB));
    assert.equal(appTagAccountA.tagId, tagId);
    assert.equal(appTagAccountB.tagId, tagId);
    assert.isFalse(
      appTagAccountA.principalVault.equals(appTagAccountB.principalVault),
    );
  });
});

describe("appmap: vote", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the "appmap: init_app" block above:
  // `Config` is a singleton, so reuse it if a prior describe block in this
  // file already created it.
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
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
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app, voteVault, voteRewardVault, tagsRewardVault };
  }

  it("locks principal, creates a VotePosition, and updates the app's total stake", async () => {
    const { app, voteVault, voteRewardVault } = await registerApp();

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

    const voteVaultBefore = await getAccount(provider.connection, voteVault);
    assert.equal(voteVaultBefore.amount.toString(), "0");

    await program.methods
      .vote(new BN(amount))
      .accounts({
        app,
        position,
        voteVault,
        voteRewardVault,
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
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalVoteStake.toString(), amount.toString());

    const voteVaultAfter = await getAccount(provider.connection, voteVault);
    assert.equal(voteVaultAfter.amount.toString(), amount.toString());

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(userTokenAfter.amount.toString(), (10_000 - amount).toString());
  });

  it("rejects a zero-amount vote", async () => {
    const { app, voteVault, voteRewardVault } = await registerApp();

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
          voteVault,
          voteRewardVault,
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

describe("appmap: withdraw_vote", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the "appmap: vote" describe block
  // above: `Config` is a singleton, so reuse it if a prior describe block in
  // this file already created it.
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
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
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app, voteVault, voteRewardVault, tagsRewardVault };
  }

  // Registers a fresh app, funds a fresh user's wallet, and votes
  // `initialStake` in to create a `VotePosition` — the common fixture every
  // `withdraw_vote` test below builds on.
  async function setupWithPosition(initialStake: number, walletAmount: number) {
    const { app, voteVault, voteRewardVault } = await registerApp();

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
        voteVault,
        voteRewardVault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      voteVault,
      voteRewardVault,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("returns principal and zeroes the position on a full withdrawal", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, voteVault, voteRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    await program.methods
      .withdrawVote(new BN(initialStake))
      .accounts({
        app,
        position,
        voteVault,
        voteRewardVault,
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

    const voteVaultAfter = await getAccount(provider.connection, voteVault);
    assert.equal(voteVaultAfter.amount.toString(), "0");

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    assert.equal(userTokenAfter.amount.toString(), walletAmount.toString());
  });

  it("leaves remaining stake on a partial withdrawal", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const { app, voteVault, voteRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, walletAmount);

    const withdrawAmount = 1_500;
    await program.methods
      .withdrawVote(new BN(withdrawAmount))
      .accounts({
        app,
        position,
        voteVault,
        voteRewardVault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.votePosition.fetch(position);
    assert.equal(
      positionAccount.amount.toString(),
      (initialStake - withdrawAmount).toString(),
    );

    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(
      appAccount.totalVoteStake.toString(),
      (initialStake - withdrawAmount).toString(),
    );

    const voteVaultAfter = await getAccount(provider.connection, voteVault);
    assert.equal(
      voteVaultAfter.amount.toString(),
      (initialStake - withdrawAmount).toString(),
    );

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - initialStake + withdrawAmount).toString(),
    );
  });

  it("rejects a zero-amount withdrawal", async () => {
    const { app, voteVault, voteRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(4_000, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawVote(new BN(0))
        .accounts({
          app,
          position,
          voteVault,
          voteRewardVault,
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
    const { app, voteVault, voteRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawVote(new BN(initialStake + 1))
        .accounts({
          app,
          position,
          voteVault,
          voteRewardVault,
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

describe("appmap: fund_app_rewards + claim_vote_reward", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the other describe blocks above:
  // `Config` is a singleton, so reuse it (and its `authority`, the
  // `provider.wallet` deployer) if a prior describe block already created
  // it.
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
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
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();
    return { appId, app, voteVault, voteRewardVault, tagsRewardVault };
  }

  // Registers a fresh app, funds a fresh user's wallet, and votes `stake`
  // in to create a `VotePosition` — the common fixture every test below
  // builds on.
  async function setupWithPosition(stake: number, walletAmount: number) {
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      await registerApp();

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
        voteVault,
        voteRewardVault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      voteVault,
      voteRewardVault,
      tagsRewardVault,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("bumps the vote-pool accumulator and transfers real tokens into the reward vault", async () => {
    const stake = 1_000;
    const { app, voteRewardVault, tagsRewardVault } = await setupWithPosition(
      stake,
      10_000,
    );

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

    const fundAmount = 500;
    await program.methods
      .fundAppRewards({ vote: {} }, new BN(fundAmount))
      .accounts({
        app,
        config: configPda,
        voteRewardVault,
        tagsRewardVault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const rewardVaultAfter = await getAccount(
      provider.connection,
      voteRewardVault,
    );
    assert.equal(rewardVaultAfter.amount.toString(), fundAmount.toString());

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
    const { app, voteRewardVault, tagsRewardVault } = await setupWithPosition(
      1_000,
      10_000,
    );

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
          voteRewardVault,
          tagsRewardVault,
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
    const { app, voteRewardVault, tagsRewardVault } = await registerApp();

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
          voteRewardVault,
          tagsRewardVault,
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
    const { app, voteVault, voteRewardVault, tagsRewardVault, user, userTokenAccount, position } =
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
        voteRewardVault,
        tagsRewardVault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (the entire
    // funded amount, since this user holds 100% of the stake).
    const expectedPending = fundAmount;

    await program.methods
      .claimVoteReward()
      .accounts({
        app,
        position,
        voteRewardVault,
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

    const rewardVaultAfter = await getAccount(provider.connection, voteRewardVault);
    assert.equal(rewardVaultAfter.amount.toString(), "0");

    // Principal vault untouched by a claim.
    const voteVaultAfter = await getAccount(provider.connection, voteVault);
    assert.equal(voteVaultAfter.amount.toString(), stake.toString());
  });

  it("pays nothing extra on a second claim with no intervening vote/fund", async () => {
    const stake = 1_000;
    const walletAmount = 10_000;
    const { app, voteRewardVault, tagsRewardVault, user, userTokenAccount, position } =
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
        voteRewardVault,
        tagsRewardVault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .claimVoteReward()
      .accounts({
        app,
        position,
        voteRewardVault,
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
        voteRewardVault,
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

describe("appmap: stake_tag", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  // Same reuse-or-initialize pattern as the other describe blocks above:
  // `Config` is a singleton, so reuse it if a prior describe block in this
  // file already created it.
  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
  }

  function deriveTagPdas(app: PublicKey, tagId: string) {
    const [appTag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), app.toBuffer(), Buffer.from(tagId)],
      program.programId,
    );
    const [principalVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag_vault"), appTag.toBuffer()],
      program.programId,
    );
    return { appTag, principalVault };
  }

  function derivePositionPda(appTag: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pos"), appTag.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  // Registers a fresh app and suggests a fresh tag on it — the common
  // fixture every `stake_tag` test below builds on.
  async function registerAppAndTag() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tagId = "defi";
    const { appTag, principalVault } = deriveTagPdas(app, tagId);
    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        appTag,
        config: configPda,
        principalVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    return {
      appId,
      app,
      voteVault,
      voteRewardVault,
      tagsRewardVault,
      appTag,
      principalVault,
    };
  }

  it("locks principal, creates a StakePosition, and updates both stake_amount and total_tag_stake", async () => {
    const { app, appTag, principalVault, tagsRewardVault } =
      await registerAppAndTag();

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

    const position = derivePositionPda(appTag, user.publicKey);
    const amount = 4_000;

    await program.methods
      .stakeTag(new BN(amount))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.owner.toBase58(), user.publicKey.toBase58());
    assert.equal(positionAccount.amount.toString(), amount.toString());
    assert.equal(positionAccount.rewardDebt.toString(), "0");

    // Both counters moved in lockstep.
    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(appTagAccount.stakeAmount.toString(), amount.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), amount.toString());

    const vaultAfter = await getAccount(provider.connection, principalVault);
    assert.equal(vaultAfter.amount.toString(), amount.toString());

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    assert.equal(userTokenAfter.amount.toString(), (10_000 - amount).toString());
  });

  it("rejects a zero-amount stake", async () => {
    const { app, appTag, principalVault, tagsRewardVault } =
      await registerAppAndTag();

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

    const position = derivePositionPda(appTag, user.publicKey);

    let threw = false;
    try {
      await program.methods
        .stakeTag(new BN(0))
        .accounts({
          app,
          appTag,
          position,
          principalVault,
          tagsRewardVault,
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
  // `constraint = app_tag.app == app.key()` check on `StakeTag::app_tag`,
  // each of `app`/`app_tag`'s seeds/bump constraints only proves internal
  // self-consistency — neither proves the two accounts belong together. An
  // attacker could permissionlessly create their OWN (app, app_tag) pair,
  // then call `stake_tag` passing THEIR `app_tag` alongside a victim's
  // well-funded `app`: `principalVault` still address-checks against the
  // attacker's own vault (their principal stays safe), but
  // `tagsRewardVault` address-checks against the VICTIM's real vault,
  // silently crediting the attacker's position against the victim's
  // `totalTagStake`/`tagsAccRewardPerShare` — a permissionless path to
  // draining every app's real reward vault. This test builds exactly that
  // mismatched pair and asserts the call is rejected with
  // `TagAppMismatch` specifically, not merely "some error".
  it("rejects a mismatched (app, appTag) pair", async () => {
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

    // Position PDA derived off the attacker's own appTag (matching what
    // `stake_tag`'s `position` seeds constraint expects), but the
    // instruction passes the VICTIM's `app`.
    const position = derivePositionPda(attacker.appTag, user.publicKey);

    let errorMessage = "";
    try {
      await program.methods
        .stakeTag(new BN(1_000))
        .accounts({
          app: victim.app,
          appTag: attacker.appTag,
          position,
          principalVault: attacker.principalVault,
          tagsRewardVault: victim.tagsRewardVault,
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
      "TagAppMismatch",
      "expected stake_tag to reject a mismatched (app, appTag) pair with TagAppMismatch",
    );

    // Nothing moved on the victim's side.
    const victimAppAccount = await program.account.appAccount.fetch(
      victim.app,
    );
    assert.equal(victimAppAccount.totalTagStake.toString(), "0");
  });

  // Exercises the reward-payout CPI leg of `stake_tag()` end-to-end via the
  // REAL `fund_app_rewards` instruction (Tags pool) rather than manually
  // poking account state — the highest-risk path (the `app` PDA, not
  // `app_tag`, signing a transfer out of the SHARED `tags_reward_vault`).
  it("pays out the pending reward from a real fund_app_rewards(Tags) call on a second stake", async () => {
    const { app, appTag, principalVault, tagsRewardVault } =
      await registerAppAndTag();

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

    const position = derivePositionPda(appTag, user.publicKey);
    const firstAmount = 1_000;
    await program.methods
      .stakeTag(new BN(firstAmount))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Fund the SHARED Tags pool with real tokens via `fund_app_rewards`.
    const { voteVault, voteRewardVault } = derivePdas(
      (await program.account.appAccount.fetch(app)).appId,
    );
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
        voteRewardVault,
        tagsRewardVault,
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
        appTag,
        position,
        principalVault,
        tagsRewardVault,
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

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(
      appTagAccount.stakeAmount.toString(),
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

    const rewardVaultAfter = await getAccount(
      provider.connection,
      tagsRewardVault,
    );
    assert.equal(
      rewardVaultAfter.amount.toString(),
      (fundAmount - expectedPending).toString(),
    );
  });
});

describe("appmap: withdraw_tag_stake", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Appmap as Program<Appmap>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  let voteMint: PublicKey;

  before(async () => {
    try {
      const config = await program.account.config.fetch(configPda);
      voteMint = config.voteMint;
      return;
    } catch {
      // Config not initialized yet — fall through and initialize it.
    }

    voteMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6,
    );
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    await program.methods
      .initialize(1000)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        voteMint,
        programData: programDataPda,
      })
      .rpc();
  });

  function derivePdas(appId: string) {
    const [app] = PublicKey.findProgramAddressSync(
      [Buffer.from("app"), Buffer.from(appId)],
      program.programId,
    );
    const [voteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_vault"), app.toBuffer()],
      program.programId,
    );
    const [voteRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_reward_vault"), app.toBuffer()],
      program.programId,
    );
    const [tagsRewardVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tags_reward_vault"), app.toBuffer()],
      program.programId,
    );
    return { app, voteVault, voteRewardVault, tagsRewardVault };
  }

  function deriveTagPdas(app: PublicKey, tagId: string) {
    const [appTag] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag"), app.toBuffer(), Buffer.from(tagId)],
      program.programId,
    );
    const [principalVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("tag_vault"), appTag.toBuffer()],
      program.programId,
    );
    return { appTag, principalVault };
  }

  function derivePositionPda(appTag: PublicKey, user: PublicKey) {
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pos"), appTag.toBuffer(), user.toBuffer()],
      program.programId,
    );
    return position;
  }

  async function registerAppAndTag() {
    const appId = `cid${randomBytes(11).toString("hex")}`;
    const { app, voteVault, voteRewardVault, tagsRewardVault } =
      derivePdas(appId);
    await program.methods
      .initApp(appId)
      .accounts({
        app,
        config: configPda,
        voteVault,
        voteRewardVault,
        tagsRewardVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    const tagId = "gaming";
    const { appTag, principalVault } = deriveTagPdas(app, tagId);
    await program.methods
      .suggestTag(appId, tagId)
      .accounts({
        app,
        appTag,
        config: configPda,
        principalVault,
        voteMint,
        payer: provider.wallet.publicKey,
      })
      .rpc();

    return {
      appId,
      app,
      voteVault,
      voteRewardVault,
      tagsRewardVault,
      appTag,
      principalVault,
    };
  }

  // Registers an app + tag, funds a fresh user's wallet, and stakes
  // `initialStake` in to create a `StakePosition` — the common fixture every
  // `withdraw_tag_stake` test below builds on.
  async function setupWithPosition(initialStake: number, walletAmount: number) {
    const { app, appTag, principalVault, tagsRewardVault } =
      await registerAppAndTag();

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

    const position = derivePositionPda(appTag, user.publicKey);

    await program.methods
      .stakeTag(new BN(initialStake))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
        userTokenAccount: userTokenAccount.address,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    return {
      app,
      appTag,
      principalVault,
      tagsRewardVault,
      user,
      userTokenAccount: userTokenAccount.address,
      position,
    };
  }

  it("returns principal and zeroes the position on a full withdrawal", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const {
      app,
      appTag,
      principalVault,
      tagsRewardVault,
      user,
      userTokenAccount,
      position,
    } = await setupWithPosition(initialStake, walletAmount);

    await program.methods
      .withdrawTagStake(new BN(initialStake))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
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

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(appTagAccount.stakeAmount.toString(), "0");
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), "0");

    const vaultAfter = await getAccount(provider.connection, principalVault);
    assert.equal(vaultAfter.amount.toString(), "0");

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(userTokenAfter.amount.toString(), walletAmount.toString());
  });

  it("leaves remaining stake on a partial withdrawal, keeping stake_amount and total_tag_stake in sync", async () => {
    const initialStake = 4_000;
    const walletAmount = 10_000;
    const {
      app,
      appTag,
      principalVault,
      tagsRewardVault,
      user,
      userTokenAccount,
      position,
    } = await setupWithPosition(initialStake, walletAmount);

    const withdrawAmount = 1_500;
    await program.methods
      .withdrawTagStake(new BN(withdrawAmount))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const remaining = initialStake - withdrawAmount;
    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), remaining.toString());

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(appTagAccount.stakeAmount.toString(), remaining.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), remaining.toString());

    const vaultAfter = await getAccount(provider.connection, principalVault);
    assert.equal(vaultAfter.amount.toString(), remaining.toString());

    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (walletAmount - initialStake + withdrawAmount).toString(),
    );
  });

  it("rejects a zero-amount withdrawal", async () => {
    const { app, appTag, principalVault, tagsRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(4_000, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawTagStake(new BN(0))
        .accounts({
          app,
          appTag,
          position,
          principalVault,
          tagsRewardVault,
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
    const { app, appTag, principalVault, tagsRewardVault, user, userTokenAccount, position } =
      await setupWithPosition(initialStake, 10_000);

    let threw = false;
    try {
      await program.methods
        .withdrawTagStake(new BN(initialStake + 1))
        .accounts({
          app,
          appTag,
          position,
          principalVault,
          tagsRewardVault,
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
    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(
      appTagAccount.stakeAmount.toString(),
      initialStake.toString(),
    );
  });

  // Regression test for a critical fund-drain vulnerability (see the
  // matching test in the "appmap: stake_tag" block for the full exploit
  // writeup): without the `constraint = app_tag.app == app.key()` check on
  // `WithdrawTagStake::app_tag`, an attacker with their OWN legitimate
  // (app, appTag, position) could call `withdraw_tag_stake` passing their
  // own `appTag`/`position` alongside a victim's well-funded `app`. The
  // pending-reward leg would then settle against the VICTIM's real
  // `tagsAccRewardPerShare` and pay out of the VICTIM's real
  // `tagsRewardVault` — while `principalVault` still address-checks against
  // the attacker's own vault, so the attacker's principal is never at risk.
  // Asserts the call is rejected with `TagAppMismatch` specifically.
  it("rejects a mismatched (app, appTag) pair", async () => {
    const victim = await registerAppAndTag();

    // The attacker's own, entirely independent app + tag, with a
    // legitimate stake already in place under the correctly-matched pair.
    const stakeAmount = 1_000;
    const attacker = await setupWithPosition(stakeAmount, 10_000);

    let errorMessage = "";
    try {
      await program.methods
        .withdrawTagStake(new BN(stakeAmount))
        .accounts({
          app: victim.app,
          appTag: attacker.appTag,
          position: attacker.position,
          principalVault: attacker.principalVault,
          tagsRewardVault: victim.tagsRewardVault,
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
      "TagAppMismatch",
      "expected withdraw_tag_stake to reject a mismatched (app, appTag) pair with TagAppMismatch",
    );

    // Nothing moved: the victim's pool and the attacker's own position are
    // both untouched.
    const victimAppAccount = await program.account.appAccount.fetch(
      victim.app,
    );
    assert.equal(victimAppAccount.totalTagStake.toString(), "0");
    const positionAccount = await program.account.stakePosition.fetch(
      attacker.position,
    );
    assert.equal(positionAccount.amount.toString(), stakeAmount.toString());
  });

  // Exercises the reward-payout CPI leg of `withdraw_tag_stake()` end-to-end
  // via a REAL `fund_app_rewards` (Tags pool) call — the highest-risk path
  // in this whole task: two different PDAs (`app` and `app_tag`) each
  // signing a transfer out of a different vault in the SAME instruction. If
  // either signer's seeds were wrong, this transaction would fail signature
  // verification outright rather than merely producing a wrong balance.
  it("pays out the pending reward from a real fund_app_rewards(Tags) call on a partial withdrawal", async () => {
    const initialStake = 1_000;
    const walletAmount = 10_000;
    const {
      app,
      appTag,
      principalVault,
      tagsRewardVault,
      user,
      userTokenAccount,
      position,
    } = await setupWithPosition(initialStake, walletAmount);

    const { voteVault, voteRewardVault } = derivePdas(
      (await program.account.appAccount.fetch(app)).appId,
    );
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
        voteRewardVault,
        tagsRewardVault,
        funderTokenAccount: funderTokenAccount.address,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // acc = 2_000 * PRECISION / 1_000 = 2 * PRECISION.
    // pending = settle_pending(1_000, 0, 2*PRECISION) = 2_000 (this user
    // holds 100% of the tag's stake, which is also 100% of the shared pool
    // since no other tag/app has staked in this test run's isolated apps).
    const expectedPending = fundAmount;

    const withdrawAmount = 400;
    await program.methods
      .withdrawTagStake(new BN(withdrawAmount))
      .accounts({
        app,
        appTag,
        position,
        principalVault,
        tagsRewardVault,
        userTokenAccount,
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const remaining = initialStake - withdrawAmount;
    const positionAccount = await program.account.stakePosition.fetch(
      position,
    );
    assert.equal(positionAccount.amount.toString(), remaining.toString());
    // reward_debt_for(remaining, 2*PRECISION) = remaining * 2.
    assert.equal(
      positionAccount.rewardDebt.toString(),
      (remaining * 2).toString(),
    );

    const appTagAccount = await program.account.appTagAccount.fetch(appTag);
    assert.equal(appTagAccount.stakeAmount.toString(), remaining.toString());
    const appAccount = await program.account.appAccount.fetch(app);
    assert.equal(appAccount.totalTagStake.toString(), remaining.toString());

    // User received both the withdrawn principal (returned by `app_tag`)
    // and the pending reward (paid by `app`).
    const userTokenAfter = await getAccount(
      provider.connection,
      userTokenAccount,
    );
    assert.equal(
      userTokenAfter.amount.toString(),
      (
        walletAmount -
        initialStake +
        withdrawAmount +
        expectedPending
      ).toString(),
    );

    // The shared reward vault paid out exactly `expectedPending`, signed by
    // `app`.
    const rewardVaultAfter = await getAccount(
      provider.connection,
      tagsRewardVault,
    );
    assert.equal(
      rewardVaultAfter.amount.toString(),
      (fundAmount - expectedPending).toString(),
    );

    // The tag's own principal vault only lost `withdrawAmount`, signed by
    // `app_tag`.
    const vaultAfter = await getAccount(provider.connection, principalVault);
    assert.equal(vaultAfter.amount.toString(), remaining.toString());
  });
});
