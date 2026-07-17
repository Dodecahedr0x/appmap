"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { config, isSimulationMode } from "@/lib/config";
import {
  getNebulousWorldProgram,
  appPda,
  appTagPda,
  votePositionPda,
  stakePositionPda,
  type ProgramTxResult,
} from "@/lib/anchorClient";

/**
 * Claims a pending vote-pool or tag-pool reward without withdrawing any
 * staked principal — the frontend counterpart to the Anchor program's
 * `claim_vote_reward`/`claim_tag_reward` instructions, which until now had
 * no caller anywhere in the app (the only way to realize a reward was to
 * withdraw the whole position). Mirrors useVoteProgram/useTagStakeProgram's
 * shape and PDA-derivation pattern exactly.
 */
export function useClaimRewards() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const claimVoteReward = useCallback(
    async (appId: string): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getNebulousWorldProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const position = votePositionPda(program.programId, app, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .claimVoteReward()
        .accountsPartial({
          app,
          position,
          voteRewardVault: appAccount.voteRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  const claimTagReward = useCallback(
    async (appId: string, tagSlug: string): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const program = getNebulousWorldProgram(connection, wallet);
      const app = appPda(program.programId, appId);
      const appTag = appTagPda(program.programId, app, tagSlug);
      const position = stakePositionPda(program.programId, appTag, wallet.publicKey);
      const mint = new PublicKey(config.solana.voteTokenMint);
      const userAta = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const appAccount = await program.account.appAccount.fetch(app);

      const sig = await program.methods
        .claimTagReward()
        .accountsPartial({
          app,
          appTag,
          position,
          tagsRewardVault: appAccount.tagsRewardVault,
          userTokenAccount: userAta,
          user: wallet.publicKey,
        })
        .rpc();

      return { txSig: sig, simulated: false };
    },
    [connection, wallet],
  );

  return { claimVoteReward, claimTagReward };
}
