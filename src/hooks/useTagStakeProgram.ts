"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { config, isSimulationMode } from "@/lib/config";
import {
  getAppmapProgram,
  appPda,
  appTagPda,
  stakePositionPda,
  toRawAmount,
  type ProgramTxResult,
} from "@/lib/anchorClient";

/**
 * Stake/withdraw a tag position against the real Anchor program. Mirrors
 * useVoteProgram, but keyed by (appId, tagSlug) instead of just appId — the
 * on-chain AppTagAccount PDA uses the tag's slug as its seed (see
 * constants.rs's MAX_TAG_ID_LEN note).
 */
export function useTagStakeProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const stakeTag = useCallback(
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getAppmapProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const appTag = appTagPda(program.programId, app, tagSlug);
      const position = stakePositionPda(program.programId, appTag, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);
      const appTagAccount = await program.account.appTagAccount.fetch(appTag);

      const sig = await program.methods
        .stakeTag(toRawAmount(amount))
        .accountsPartial({
          app,
          appTag,
          position,
          principalVault: appTagAccount.principalVault,
          tagsRewardVault: appAccount.tagsRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  const withdrawTagStake = useCallback(
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getAppmapProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const appTag = appTagPda(program.programId, app, tagSlug);
      const position = stakePositionPda(program.programId, appTag, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);
      const appTagAccount = await program.account.appTagAccount.fetch(appTag);

      const sig = await program.methods
        .withdrawTagStake(toRawAmount(amount))
        .accountsPartial({
          app,
          appTag,
          position,
          principalVault: appTagAccount.principalVault,
          tagsRewardVault: appAccount.tagsRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  return { stakeTag, withdrawTagStake };
}
