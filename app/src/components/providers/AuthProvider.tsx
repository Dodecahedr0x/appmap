"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";

export interface AuthUser {
  id: string;
  wallet: string;
  handle: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  connectingSession: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * A connected wallet is enough to be "signed in" — there's no separate
 * message-signing step. Real authorization for anything that spends value
 * (votes, stakes, buys) comes from the wallet's own signature on that
 * transaction; this session cookie is just bookkeeping (display name, DB FK
 * for submissions), so it's established automatically the moment a wallet
 * connects.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, disconnect } = useWallet();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectingSession, setConnectingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = await res.json();
      setUser(json.ok ? json.data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // As soon as a wallet is connected (and isn't already the signed-in
  // wallet), start a session for it — no signature required.
  useEffect(() => {
    if (!connected || !publicKey) return;
    const wallet = publicKey.toBase58();
    if (user?.wallet === wallet) return;

    let cancelled = false;
    setError(null);
    setConnectingSession(true);
    fetch("/api/auth/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "Could not connect");
        setUser(json.data.user);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not connect");
        }
      })
      .finally(() => {
        if (!cancelled) setConnectingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, user?.wallet]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    try {
      await disconnect();
    } catch {
      /* wallet already disconnected */
    }
  }, [disconnect]);

  // If the wallet disconnects, clear the local user (session cookie is cleared
  // lazily on next protected action / explicit sign-out).
  useEffect(() => {
    if (!connected && user) {
      setUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, connectingSession, error, signOut, refresh }),
    [user, loading, connectingSession, error, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
