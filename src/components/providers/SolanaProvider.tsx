"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { config } from "@/lib/config";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Wraps the app with Solana connection + wallet context. Wallet standard wallets
 * (Phantom, Solflare, Backpack, etc.) are auto-detected; we register a couple of
 * legacy adapters as a fallback for browsers without wallet-standard support.
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = config.solana.rpc;
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
