"use client";

import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { cn, formatToken } from "@/lib/utils";

// The one-click default — small enough to be a low-stakes "I agree" tap,
// distinct from VotePanel's larger PRESETS (10/50/100/500) which stay the
// destination for anyone who wants to stake something meaningful.
const QUICK_VOTE_AMOUNT = 10;
const CUSTOM_PRESETS = [10, 50, 100, 500];

/**
 * Compact vote action for AppCard's stats row: one click casts
 * QUICK_VOTE_AMOUNT immediately (optimistic UI, confirms in the
 * background); a "…" affordance next to it opens a small popover for a
 * custom amount. Stops propagation on every interaction so it works inside
 * AppCard's outer `<Link>` without navigating to the app page.
 */
export function CardVoteButton({
  appId,
  voteWeight,
}: {
  appId: string;
  voteWeight: number;
}) {
  const { user } = useAuth();
  const { setVisible } = useWalletModal();
  const toast = useToast();
  const { vote: castVote } = useVoteProgram();

  const [optimisticWeight, setOptimisticWeight] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(QUICK_VOTE_AMOUNT);

  const displayWeight = optimisticWeight ?? voteWeight;

  async function submitVote(amount: number) {
    if (amount <= 0 || busy) return;
    setBusy(true);
    setPickerOpen(false);
    const prevOptimistic = optimisticWeight ?? voteWeight;
    setOptimisticWeight(prevOptimistic + amount);
    try {
      const { txSig, simulated } = await castVote(appId, amount);
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
    } catch (err) {
      // Roll back the optimistic bump — the vote didn't actually land. Reset
      // to prevOptimistic (the value right before this attempt), not the
      // stale voteWeight prop, so an earlier successful vote in the same
      // session isn't silently wiped from the display by a later failure.
      setOptimisticWeight(prevOptimistic);
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  function onQuickVote(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      setVisible(true);
      return;
    }
    void submitVote(QUICK_VOTE_AMOUNT);
  }

  function onOpenPicker(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      setVisible(true);
      return;
    }
    setPickerOpen((v) => !v);
  }

  return (
    <div className="relative flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onQuickVote}
        disabled={busy}
        className="flex items-center gap-1 rounded-pill border border-hairline bg-ivory px-2 py-1 text-xs font-semibold text-ink transition-colors duration-150 hover:border-cobalt/50 hover:text-cobalt disabled:opacity-50"
        aria-label={`Vote ${QUICK_VOTE_AMOUNT} ${TOKEN_SYMBOL} for this app`}
        title={isSimulationMode() ? "Simulated — no real tokens spent" : undefined}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M10 3l6 8h-4v6H8v-6H4l6-8z" />
        </svg>
        <span className="tabular-nums">{formatToken(displayWeight, "")}</span>
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        className="rounded-pill border border-hairline bg-ivory px-1.5 py-1 text-xs text-slate transition-colors duration-150 hover:text-ink"
        aria-label="Vote a custom amount"
        aria-expanded={pickerOpen}
      >
        •••
      </button>

      {pickerOpen && (
        // Relies on ~120px of content above the vote row within the card
        // (image + title strip) to avoid being clipped by AppCard's outer
        // overflow-hidden — see Task 8 code review. If card content ever
        // shrinks below that, portal this to document.body like Modal.tsx does.
        <div
          role="dialog"
          aria-label="Custom vote amount"
          className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-card border border-hairline bg-cream p-3 shadow-hover"
        >
          <div className="flex flex-wrap gap-1.5">
            {CUSTOM_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCustomAmount(p)}
                className={cn("chip", customAmount === p && "chip-active")}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="input px-2 py-1 text-xs"
              value={customAmount}
              onChange={(e) => setCustomAmount(Math.max(0, Number(e.target.value)))}
              aria-label="Custom vote amount"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              disabled={busy || customAmount <= 0}
              onClick={() => submitVote(customAmount)}
            >
              Vote
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
