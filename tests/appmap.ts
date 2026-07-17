import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { assert } from "chai";
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
