"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export interface WalletBalances {
  neb: number | null;
  usdc: number | null;
  refresh: () => void;
}

async function fetchAtaBalance(connection: Connection, mint: PublicKey, owner: PublicKey) {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const { value } = await connection.getTokenAccountBalance(ata);
    return value.uiAmount ?? 0;
  } catch {
    // No ATA yet (never held the token) — treat as a zero balance.
    return 0;
  }
}

/** The connected wallet's NEB and USDC balances, for display next to the buy panel. */
export function useWalletBalances(nebMint: string | null, usdcMint: string | null): WalletBalances {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [neb, setNeb] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!publicKey || !nebMint || !usdcMint) {
      setNeb(null);
      setUsdc(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchAtaBalance(connection, new PublicKey(nebMint), publicKey),
      fetchAtaBalance(connection, new PublicKey(usdcMint), publicKey),
    ]).then(([nebBalance, usdcBalance]) => {
      if (cancelled) return;
      setNeb(nebBalance);
      setUsdc(usdcBalance);
    });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, nebMint, usdcMint, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { neb, usdc, refresh };
}
