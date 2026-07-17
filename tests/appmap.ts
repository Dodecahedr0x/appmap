import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Appmap } from "../target/types/appmap";

describe("appmap", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Appmap as Program<Appmap>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
