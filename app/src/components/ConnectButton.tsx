"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/providers/AuthProvider";
import { shortAddress } from "@/lib/utils";

/**
 * A single control: connect the wallet, and that's it — no separate sign-in
 * step. Once connected, this same button shows the wallet identity, and
 * clicking it disconnects — one toggle, not a separate "sign out" control
 * to notice.
 */
export function ConnectButton() {
  const { connected, publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { user, signOut, connectingSession } = useAuth();

  if (!connected) {
    return (
      <button
        className="btn-primary shrink-0 whitespace-nowrap px-3 py-2 md:px-6 md:py-3"
        disabled={connecting}
        onClick={() => setVisible(true)}
      >
        {connecting ? (
          "Connecting…"
        ) : (
          <>
            <span className="md:hidden">Connect</span>
            <span className="hidden md:inline">Connect wallet</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="chip chip-active shrink-0 whitespace-nowrap font-mono transition-colors duration-150 hover:border-negative/60 hover:text-negative"
      disabled={connectingSession}
      onClick={() => signOut()}
      title="Click to disconnect"
    >
      {user?.handle ??
        shortAddress(user?.wallet ?? publicKey?.toBase58() ?? "")}
    </button>
  );
}
