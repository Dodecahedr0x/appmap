"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/providers/AuthProvider";
import { shortAddress } from "@/lib/utils";
import { useToast } from "@/components/ui/Toaster";

/**
 * A single control that walks the user through the connect → sign-in flow and,
 * once authenticated, shows their wallet + a sign-out affordance.
 */
export function ConnectButton() {
  const { connected, publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { user, signIn, signOut, signingIn } = useAuth();
  const toast = useToast();

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="chip chip-active font-mono">
          {user.handle ?? shortAddress(user.wallet)}
        </span>
        <button className="btn-ghost text-xs" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

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

  // Connected but not authenticated yet → prompt to sign the challenge.
  return (
    <div className="flex items-center gap-2">
      <span className="chip font-mono">
        {shortAddress(publicKey?.toBase58() ?? "")}
      </span>
      <button
        className="btn-primary"
        disabled={signingIn}
        onClick={async () => {
          const okSignIn = await signIn();
          if (okSignIn) toast.success("Signed in");
        }}
      >
        {signingIn ? "Check wallet…" : "Sign in"}
      </button>
    </div>
  );
}
