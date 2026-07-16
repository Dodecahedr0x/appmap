"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useTokenTransfer } from "@/hooks/useTokenTransfer";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { ConnectButton } from "@/components/ConnectButton";

const PRESETS = [10, 50, 100, 500];

/**
 * The vote widget. Commits vote-tokens to an app: settles an on-chain transfer
 * (or simulates it), then records the vote server-side where it feeds ranking.
 */
export function VotePanel({ appId, slug }: { appId: string; slug: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const transfer = useTokenTransfer();
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);

  async function vote() {
    if (amount <= 0) return;
    setBusy(true);
    try {
      // 1. Settle the token transfer (real tx in on-chain mode; no-op otherwise).
      const { txSig, simulated } = await transfer(amount);

      // 2. Record the vote.
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, amount, txSig: txSig ?? undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Vote failed");

      toast.success(
        simulated
          ? `Voted ${amount} ${TOKEN_SYMBOL} (simulated)`
          : `Voted ${amount} ${TOKEN_SYMBOL} — tx confirmed`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Vote for this app
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Votes are token-weighted and boost this app&apos;s rank.
          {isSimulationMode() && " Running in simulation mode — no real tokens spent."}
        </p>
      </div>

      {!user ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-400">Sign in to vote.</p>
          <ConnectButton />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                className={`chip ${amount === p ? "chip-active" : ""}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="input"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              aria-label="Vote amount"
            />
            <span className="text-sm text-slate-400">{TOKEN_SYMBOL}</span>
          </div>
          <button
            className="btn-primary w-full"
            disabled={busy || amount <= 0}
            onClick={vote}
          >
            {busy ? "Voting…" : `Vote ${amount} ${TOKEN_SYMBOL}`}
          </button>
        </>
      )}
    </section>
  );
}
