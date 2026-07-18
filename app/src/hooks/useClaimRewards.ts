"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ProgramTxResult } from "@/lib/anchorClient";
import { runProgramTx } from "@/lib/txClient";

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
    async (appId: string): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/claim-vote-reward", { appId }),
    [wallet],
  );

  const claimTagReward = useCallback(
    async (appId: string, tagSlug: string): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/claim-tag-reward", { appId, tagSlug }),
    [wallet],
  );

  return { claimVoteReward, claimTagReward };
}
