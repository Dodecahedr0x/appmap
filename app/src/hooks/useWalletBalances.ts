"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiGet } from "@/lib/txClient";

export interface WalletBalances {
  neb: number | null;
  usdc: number | null;
  refresh: () => void;
}

async function fetchBalance(owner: string, mint: string): Promise<number> {
  try {
    const { uiAmountString } = await apiGet<{ uiAmountString: string }>(
      `/api/balances/${owner}/${mint}`,
    );
    return Number(uiAmountString);
  } catch {
    // No ATA yet (never held the token) — treat as a zero balance.
    return 0;
  }
}

/** The connected wallet's NEB and USDC balances, for display next to the buy panel. */
export function useWalletBalances(nebMint: string | null, usdcMint: string | null): WalletBalances {
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
    const owner = publicKey.toBase58();
    Promise.all([fetchBalance(owner, nebMint), fetchBalance(owner, usdcMint)]).then(
      ([nebBalance, usdcBalance]) => {
        if (cancelled) return;
        setNeb(nebBalance);
        setUsdc(usdcBalance);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKey, nebMint, usdcMint, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { neb, usdc, refresh };
}
