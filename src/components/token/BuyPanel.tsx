"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useNebPoolProgram } from "@/hooks/useNebPoolProgram";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import { computeBuyQuote, type PoolStatus } from "@/lib/pool";
import { ConnectButton } from "@/components/ConnectButton";

const PRESETS = [0.1, 0.5, 1, 5];

export function BuyPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const { buy } = useNebPoolProgram();
  const [pool, setPool] = useState<PoolStatus | null | undefined>(undefined);
  const [solAmount, setSolAmount] = useState(0.5);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/pool");
    const json = await res.json();
    setPool(json.ok ? json.data.pool : null);
  }

  useEffect(() => {
    refresh().catch(() => setPool(null));
  }, []);

  const quote = useMemo(() => {
    if (!pool || solAmount <= 0) return null;
    try {
      return computeBuyQuote(pool, solAmount);
    } catch {
      return null;
    }
  }, [pool, solAmount]);

  const soldOut = pool != null && pool.remainingSupply <= 0;

  async function handleBuy() {
    if (solAmount <= 0) return;
    setBusy(true);
    try {
      const { txSig, simulated } = await buy(solAmount);

      const res = await fetch("/api/pool/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solAmount, txSig: txSig ?? undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Purchase failed");

      toast.success(
        simulated
          ? `Bought ${formatToken(json.data.purchase.nebAmount, TOKEN_SYMBOL)} (simulated)`
          : `Bought ${formatToken(json.data.purchase.nebAmount, TOKEN_SYMBOL)} — tx confirmed`,
      );
      setPool(json.data.pool);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setBusy(false);
    }
  }

  if (pool === undefined) {
    return <section className="card p-6 text-sm text-slate">Loading pool…</section>;
  }

  if (pool === null) {
    return (
      <section className="card p-6 text-sm text-slate">
        The {TOKEN_SYMBOL} pool hasn&apos;t been seeded yet.
      </section>
    );
  }

  const pct = Math.round(pool.soldFraction * 100);

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Buy {TOKEN_SYMBOL}
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Single-sided bonding-curve sale — price rises as supply depletes.
          {isSimulationMode() && " Running in simulation mode — no real SOL spent."}
        </p>
      </div>

      <div className="space-y-1">
        <div className="h-2 overflow-hidden rounded-pill bg-ivory">
          <div
            className="h-full rounded-pill bg-cobalt transition-[width]"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-steel">
          <span>{formatToken(pool.remainingSupply, TOKEN_SYMBOL)} left</span>
          <span>{pct}% sold · {pool.solRaised.toFixed(2)} SOL raised</span>
        </div>
      </div>

      {soldOut ? (
        <p className="text-sm font-medium text-slate">Sold out — the entire supply has been bought.</p>
      ) : !user ? (
        <div className="space-y-2">
          <p className="text-sm text-slate">Sign in to buy.</p>
          <ConnectButton />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setSolAmount(p)}
                className={`chip ${solAmount === p ? "chip-active" : ""}`}
              >
                {p} SOL
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={0.01}
              className="input"
              value={solAmount}
              onChange={(e) => setSolAmount(Math.max(0, Number(e.target.value)))}
              aria-label="SOL amount"
            />
            <span className="text-sm text-slate">SOL</span>
          </div>
          {quote != null && (
            <p className="text-xs text-slate-steel">
              ≈ {formatToken(quote, TOKEN_SYMBOL)} at the current price
            </p>
          )}
          <button
            className="btn-primary w-full"
            disabled={busy || solAmount <= 0 || quote == null}
            onClick={handleBuy}
          >
            {busy ? "Buying…" : `Buy for ${solAmount} SOL`}
          </button>
        </>
      )}
    </section>
  );
}
