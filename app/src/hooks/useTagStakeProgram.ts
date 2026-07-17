"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isSimulationMode } from "@/lib/config";
import { toRawAmount, type ProgramTxResult } from "@/lib/anchorClient";
import { apiPost, signAndSubmit } from "@/lib/txClient";

/**
 * Stake/withdraw a tag position against the real Anchor program. Mirrors
 * useVoteProgram, but keyed by (appId, tagSlug) instead of just appId — the
 * tag itself is a global on-chain `Tag` PDA seeded only by the tag slug, and
 * the per-app stake accounting lives on a separate `AppTagStake` PDA keyed
 * by (app, tag) (see constants.rs's MAX_TAG_ID_LEN note).
 */
export function useTagStakeProgram() {
  const wallet = useWallet();

  const stakeTag = useCallback(
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>("/api/tx/stake-tag", {
        appId,
        tagSlug,
        amount: toRawAmount(amount).toString(),
        user: wallet.publicKey.toBase58(),
      });
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  const withdrawTagStake = useCallback(
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>(
        "/api/tx/withdraw-tag-stake",
        {
          appId,
          tagSlug,
          amount: toRawAmount(amount).toString(),
          user: wallet.publicKey.toBase58(),
        },
      );
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  return { stakeTag, withdrawTagStake };
}
