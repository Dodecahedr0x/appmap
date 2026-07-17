"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { config, isSimulationMode } from "@/lib/config";
import {
  getNebulousWorldProgram,
  nebPoolPda,
  toRawLamports,
  type ProgramTxResult,
} from "@/lib/anchorClient";

/**
 * Buys NEB off the single-sided bonding-curve pool via the real Anchor
 * program. In simulation mode (no mint configured) resolves immediately
 * without touching the chain, same as useVoteProgram.
 */
export function useNebPoolProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const buy = useCallback(
    async (solAmount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getNebulousWorldProgram(connection, wallet);
      const pool = nebPoolPda(program.programId);
      const poolAccount = await program.account.nebPool.fetch(pool);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const buyerAta = await getAssociatedTokenAddress(mint, wallet.publicKey);

      // Buying is often a brand-new holder's very first NEB touchpoint, so
      // (unlike vote/stake, which assume an ATA already exists) idempotently
      // create it if needed — a no-op if the buyer already has one.
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        buyerAta,
        wallet.publicKey,
        mint,
      );

      const sig = await program.methods
        .buyNeb(toRawLamports(solAmount))
        .accountsPartial({
          pool,
          tokenVault: poolAccount.tokenVault,
          buyerTokenAccount: buyerAta,
          buyer: wallet.publicKey,
        })
        .preInstructions([createAtaIx])
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  return { buy };
}
