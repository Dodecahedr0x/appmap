"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { loadNebPool } from "@/lib/dlmm";

const SLIPPAGE_BPS = new BN(100); // 1%

export interface SwapResult {
  txSig: string;
  nebOut: number;
}

/**
 * Buys NEB by swapping USDC against the live NEB/USDC Meteora DLMM pool —
 * this is a real on-chain swap through Meteora's own program, not a call
 * into ours. There's no "simulation mode" here (unlike vote/stake): without
 * a real configured pool there's no curve to simulate a quote from.
 */
export function useNebDlmmSwap() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const buy = useCallback(
    async (usdcAmount: number): Promise<SwapResult> => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Connect your wallet first");
      }

      const pool = await loadNebPool(connection);
      if (!pool) throw new Error("NEB isn't tradable yet — no pool configured");
      await pool.refetchStates();

      const usdcMint = pool.tokenY.publicKey;
      const nebMint = pool.tokenX.publicKey;
      const inAmount = new BN(Math.round(usdcAmount * 10 ** pool.tokenY.mint.decimals));

      const binArrays = await pool.getBinArrays();
      const quote = pool.swapQuote(inAmount, false, SLIPPAGE_BPS, binArrays);

      const tx = await pool.swap({
        inToken: usdcMint,
        outToken: nebMint,
        inAmount,
        minOutAmount: quote.minOutAmount,
        lbPair: pool.pubkey,
        user: wallet.publicKey,
        binArraysPubkey: quote.binArraysPubkey,
      });

      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      return {
        txSig: sig,
        nebOut: Number(quote.outAmount) / 10 ** pool.tokenX.mint.decimals,
      };
    },
    [connection, wallet],
  );

  return { buy };
}
