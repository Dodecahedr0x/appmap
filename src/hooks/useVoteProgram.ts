"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { config, isSimulationMode } from "@/lib/config";
import {
  getNebulousWorldProgram,
  appPda,
  votePositionPda,
  toRawAmount,
  type ProgramTxResult,
} from "@/lib/anchorClient";

/**
 * Vote/withdraw against the real Anchor program. In simulation mode (no
 * mint configured) both resolve immediately without touching the chain, same
 * as the plain-transfer hook this replaces.
 */
export function useVoteProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const vote = useCallback(
    async (appId: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getNebulousWorldProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const position = votePositionPda(program.programId, app, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .vote(toRawAmount(amount))
        .accountsPartial({
          app,
          position,
          voteVault: appAccount.voteVault,
          voteRewardVault: appAccount.voteRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  const withdrawVote = useCallback(
    async (appId: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getNebulousWorldProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const position = votePositionPda(program.programId, app, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .withdrawVote(toRawAmount(amount))
        .accountsPartial({
          app,
          position,
          voteVault: appAccount.voteVault,
          voteRewardVault: appAccount.voteRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  return { vote, withdrawVote };
}
