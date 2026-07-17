"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useNebDlmmSwap } from "@/hooks/useNebDlmmSwap";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import type { NebPoolStatus } from "@/lib/dlmm";
import { ConnectButton } from "@/components/ConnectButton";

const PRESETS = [10, 50, 100, 500];

export function BuyPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const { buy } = useNebDlmmSwap();
  const [pool, setPool] = useState<NebPoolStatus | null | undefined>(undefined);
  const [usdcAmount, setUsdcAmount] = useState(50);
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
    if (!pool || usdcAmount <= 0) return null;
    return usdcAmount / pool.price;
  }, [pool, usdcAmount]);

  async function handleBuy() {
    if (usdcAmount <= 0) return;
    setBusy(true);
    try {
      const { nebOut } = await buy(usdcAmount);
      toast.success(`Bought ${formatToken(nebOut, TOKEN_SYMBOL)} — tx confirmed`);
      await refresh();
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
        {TOKEN_SYMBOL} isn&apos;t tradable yet — the launch pool hasn&apos;t been created.
      </section>
    );
  }

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Buy {TOKEN_SYMBOL}
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Swaps USDC for {TOKEN_SYMBOL} directly against the public NEB/USDC Meteora DLMM pool.
        </p>
      </div>

      <div className="flex justify-between text-xs text-slate-steel">
        <span>{formatToken(pool.nebReserve, TOKEN_SYMBOL)} in pool</span>
        <span>1 {TOKEN_SYMBOL} ≈ {pool.price.toFixed(6)} USDC</span>
      </div>

      {!user ? (
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
                onClick={() => setUsdcAmount(p)}
                className={`chip ${usdcAmount === p ? "chip-active" : ""}`}
              >
                {p} USDC
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1}
              className="input"
              value={usdcAmount}
              onChange={(e) => setUsdcAmount(Math.max(0, Number(e.target.value)))}
              aria-label="USDC amount"
            />
            <span className="text-sm text-slate">USDC</span>
          </div>
          {quote != null && (
            <p className="text-xs text-slate-steel">
              ≈ {formatToken(quote, TOKEN_SYMBOL)} at the current price
            </p>
          )}
          <button
            className="btn-primary w-full"
            disabled={busy || usdcAmount <= 0}
            onClick={handleBuy}
          >
            {busy ? "Buying…" : `Buy for ${usdcAmount} USDC`}
          </button>
        </>
      )}
    </section>
  );
}
