"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiPost, signAndSubmit } from "@/lib/txClient";

export interface SwapResult {
  txSig: string;
  nebOut: number;
}

/**
 * Buys NEB by swapping USDC against the live NEB/USDC Meteora DLMM pool —
 * this is a real on-chain swap through Meteora's own program, not a call
 * into ours. There's no "simulation mode" here (unlike vote/stake): without
 * a real configured pool there's no curve to simulate a quote from.
 *
 * The swap-quote/instruction-building logic that used to live here (see
 * git history) now runs in the indexer's dlmm-bridge sidecar
 * (indexer/dlmm-bridge/src/swap.ts) — this hook just asks it to build an
 * unsigned transaction, signs it with the connected wallet, and submits
 * the signed bytes via /api/tx/submit.
 */
export function useNebDlmmSwap() {
  const wallet = useWallet();

  const buy = useCallback(
    async (usdcAmount: number): Promise<SwapResult> => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");

      const { transaction, nebOut } = await apiPost<{ transaction: string; nebOut: number }>(
        "/api/tx/buy-neb",
        { usdcAmount, user: wallet.publicKey.toBase58() },
      );
      const txSig = await signAndSubmit(wallet, transaction);
      return { txSig, nebOut };
    },
    [wallet],
  );

  return { buy };
}
