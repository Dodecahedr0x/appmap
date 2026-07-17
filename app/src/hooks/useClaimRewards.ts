"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isSimulationMode } from "@/lib/config";
import type { ProgramTxResult } from "@/lib/anchorClient";
import { apiPost, signAndSubmit } from "@/lib/txClient";

/**
 * Claims a pending vote-pool or tag-pool reward without withdrawing any
 * staked principal — the frontend counterpart to the Anchor program's
 * `claim_vote_reward`/`claim_tag_reward` instructions. Mirrors
 * useVoteProgram/useTagStakeProgram's shape: the indexer builds the
 * unsigned transaction (see app/api/tx/claim-vote-reward,
 * app/api/tx/claim-tag-reward), the wallet signs it locally.
 */
export function useClaimRewards() {
  const wallet = useWallet();

  const claimVoteReward = useCallback(
    async (appId: string): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>(
        "/api/tx/claim-vote-reward",
        { appId, user: wallet.publicKey.toBase58() },
      );
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  const claimTagReward = useCallback(
    async (appId: string, tagSlug: string): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>(
        "/api/tx/claim-tag-reward",
        { appId, tagSlug, user: wallet.publicKey.toBase58() },
      );
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  return { claimVoteReward, claimTagReward };
}
