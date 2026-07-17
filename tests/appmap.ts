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
