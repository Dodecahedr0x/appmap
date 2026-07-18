"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { ConnectButton } from "@/components/ConnectButton";

const PRESETS = [10, 50, 100, 500];

/**
 * The vote widget. Commits vote-tokens to an app: settles an on-chain transfer
 * (or simulates it), then records the vote server-side where it feeds ranking.
 */
export function VotePanel({ appId }: { appId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { vote: castVote, withdrawVote } = useVoteProgram();
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [myVote, setMyVote] = useState<{ id: string; amount: number } | null>(null);

  useEffect(() => {
    if (!user) {
      setMyVote(null);
      return;
    }
    fetch(`/api/vote?appId=${appId}`)
      .then((res) => res.json())
      .then((json) => setMyVote(json.ok ? json.data.vote : null))
      .catch(() => {});
  }, [appId, user]);

  async function vote() {
    if (amount <= 0) return;
    setBusy(true);
    try {
      // 1. Settle the token transfer (real tx in on-chain mode; no-op otherwise).
      const { txSig, simulated } = await castVote(appId, amount);

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
        txSig ? { txSig } : undefined,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!myVote) return;
    setBusy(true);
    try {
      const { txSig, simulated } = await withdrawVote(appId, myVote.amount);

      const res = await fetch("/api/vote/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voteId: myVote.id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Withdraw failed");

      toast.success(
        simulated
          ? "Vote withdrawn (simulated)"
          : "Vote withdrawn — tokens returned",
        txSig ? { txSig } : undefined,
      );
      setMyVote(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Vote for this app
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Votes are token-weighted and boost this app&apos;s rank.
          {isSimulationMode() && " Running in simulation mode — no real tokens spent."}
        </p>
      </div>

      {!user ? (
        <div className="space-y-2">
          <p className="text-sm text-slate">Sign in to vote.</p>
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
            <span className="text-sm text-slate">{TOKEN_SYMBOL}</span>
          </div>
          <button
            className="btn-primary w-full"
            disabled={busy || amount <= 0}
            onClick={vote}
          >
            {busy ? "Voting…" : `Vote ${amount} ${TOKEN_SYMBOL}`}
          </button>
          {myVote && (
            <button
              className="btn-secondary w-full"
              disabled={busy}
              onClick={withdraw}
            >
              {busy ? "Withdrawing…" : `Withdraw ${myVote.amount} ${TOKEN_SYMBOL}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
