"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isSimulationMode } from "@/lib/config";
import { toRawAmount, type ProgramTxResult } from "@/lib/anchorClient";
import { apiPost, signAndSubmit } from "@/lib/txClient";

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
    async (appId: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>("/api/tx/vote", {
        appId,
        amount: toRawAmount(amount).toString(),
        user: wallet.publicKey.toBase58(),
      });
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  const withdrawVote = useCallback(
    async (appId: string, amount: number): Promise<ProgramTxResult> => {
      if (isSimulationMode()) return { txSig: null, simulated: true };
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction } = await apiPost<{ transaction: string }>("/api/tx/withdraw-vote", {
        appId,
        amount: toRawAmount(amount).toString(),
        user: wallet.publicKey.toBase58(),
      });
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, simulated: false };
    },
    [wallet],
  );

  return { vote, withdrawVote };
}
