"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toRawAmount, type ProgramTxResult } from "@/lib/anchorClient";
import { runProgramTx } from "@/lib/txClient";

/**
 * Vote/withdraw against the real Anchor program. In simulation mode (no
 * mint configured) both resolve immediately without touching the chain,
 * same as the plain-transfer hook this replaces. On a real deployment, the
 * indexer builds the unsigned transaction (see app/api/tx/vote,
 * app/api/tx/withdraw-vote) — the wallet signs it locally and the indexer
 * relays it; this hook never holds an RPC connection of its own.
 */
export function useVoteProgram() {
  const wallet = useWallet();

  const vote = useCallback(
    async (appId: string, amount: number): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/vote", { appId, amount: toRawAmount(amount).toString() }),
    [wallet],
  );

  const withdrawVote = useCallback(
    async (appId: string, amount: number): Promise<ProgramTxResult> =>
      runProgramTx(wallet, "/api/tx/withdraw-vote", { appId, amount: toRawAmount(amount).toString() }),
    [wallet],
  );

  return { vote, withdrawVote };
}
