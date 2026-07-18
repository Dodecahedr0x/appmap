"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toRawAmount, type ProgramTxResult } from "@/lib/anchorClient";
import { runProgramTx } from "@/lib/txClient";

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
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/stake-tag", {
        appId,
        tagSlug,
        amount: toRawAmount(amount).toString(),
      }),
    [wallet],
  );

  const withdrawTagStake = useCallback(
    async (appId: string, tagSlug: string, amount: number): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/withdraw-tag-stake", {
        appId,
        tagSlug,
        amount: toRawAmount(amount).toString(),
      }),
    [wallet],
  );

  return { stakeTag, withdrawTagStake };
}
