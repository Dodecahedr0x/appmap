"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/providers/AuthProvider";
import { shortAddress } from "@/lib/utils";

/**
 * A single control: connect the wallet, and that's it — no separate sign-in
 * step. Once connected, shows the wallet + a disconnect affordance.
 */
export function ConnectButton() {
  const { connected, publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { user, signOut, connectingSession } = useAuth();

  if (!connected) {
    return (
      <button
        className="btn-primary"
        disabled={connecting}
        onClick={() => setVisible(true)}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="chip chip-active font-mono">
        {user?.handle ??
          shortAddress(user?.wallet ?? publicKey?.toBase58() ?? "")}
      </span>
      <button
        className="btn-ghost text-xs"
        disabled={connectingSession}
        onClick={() => signOut()}
      >
        Sign out
      </button>
    </div>
  );
}
