"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { config, isSimulationMode } from "@/lib/config";

export interface TransferResult {
  /** Confirmed transaction signature, or null when running in simulation mode. */
  txSig: string | null;
  simulated: boolean;
}

/**
 * Transfer `amount` (UI units) of the configured vote token from the connected
 * wallet to the treasury. This is the on-chain settlement backing a vote or a
 * stake.
 *
 * In simulation mode (no mint configured) it resolves immediately with
 * `{ txSig: null, simulated: true }` so the same UI flow works without a funded
 * wallet or deployed program.
 */
export function useTokenTransfer() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  return useCallback(
    async (amount: number): Promise<TransferResult> => {
      if (isSimulationMode()) {
        return { txSig: null, simulated: true };
      }
      if (!publicKey) throw new Error("Connect your wallet first");
      if (!config.solana.treasury) {
        throw new Error("Treasury address is not configured");
      }

      const mint = new PublicKey(config.solana.voteTokenMint);
      const treasury = new PublicKey(config.solana.treasury);
      const decimals = config.solana.voteTokenDecimals;
      const rawAmount = BigInt(Math.round(amount * 10 ** decimals));

      const fromAta = await getAssociatedTokenAddress(mint, publicKey);
      const toAta = await getAssociatedTokenAddress(mint, treasury);

      const tx = new Transaction();

      // Create the treasury's token account if it doesn't exist yet (payer = user).
      try {
        await getAccount(connection, toAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            toAta,
            treasury,
            mint,
          ),
        );
      }

      tx.add(
        createTransferCheckedInstruction(
          fromAta,
          mint,
          toAta,
          publicKey,
          rawAmount,
          decimals,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      return { txSig: sig, simulated: false };
    },
    [connection, publicKey, sendTransaction],
  );
}
