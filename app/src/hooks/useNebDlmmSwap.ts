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
      const signTransaction = wallet.signTransaction;
      if (!wallet.publicKey || !signTransaction) {
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

      // Sign locally and submit through our own `connection` rather than
      // wallet.sendTransaction() — for wallets exposing the
      // SolanaSignAndSendTransaction feature, that call hands the tx off to
      // the wallet's *own* RPC for the resolved chain (see
      // @solana/wallet-standard-wallet-adapter-base), which can be a
      // different node than the one that just fetched `tx`'s blockhash and
      // fails with "blockhash not found". Every other on-chain call in this
      // app (via AnchorProvider/.rpc()) already signs-then-submits this way.
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
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
