"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ProgramTxResult } from "@/lib/anchorClient";
import { runProgramTx } from "@/lib/txClient";

/**
 * Closes an emptied `VotePosition`/`StakePosition`, reclaiming its rent SOL
 * for whoever originally paid it — the frontend counterpart to the Anchor
 * program's `close_vote_position`/`close_tag_stake_position` instructions.
 * Mirrors useClaimRewards's shape: the indexer builds the unsigned
 * transaction (see app/api/tx/close-vote-position,
 * app/api/tx/close-tag-stake-position) from just the position's own pubkey,
 * the wallet signs it locally.
 */
export function useClosePositions() {
  const wallet = useWallet();

  const closeVotePosition = useCallback(
    async (position: string): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/close-vote-position", { position }),
    [wallet],
  );

  const closeTagStakePosition = useCallback(
    async (position: string): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/close-tag-stake-position", { position }),
    [wallet],
  );

  return { closeVotePosition, closeTagStakePosition };
}
