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
