import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import type { NebPoolStatus } from "@/lib/indexerClient";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline p-4">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</div>
      <div className="mt-1 text-heading font-bold text-ink">{value}</div>
    </div>
  );
}

/**
 * Live NEB/USDC Meteora DLMM pool indicators (price, reserves) — proxied
 * from the indexer (see lib/indexerClient.ts's fetchPoolStatus), not a DB
 * cache. Unlike the old native bonding-curve pool, swaps against this pool
 * don't go through our API, so there's no local purchase ledger left to
 * chart a history from — this is a snapshot, not a time series.
 */
export function PoolAnalytics({ pool }: { pool: NebPoolStatus | null }) {
  if (!pool) {
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
          Pool analytics
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Live indicators from the public NEB/USDC Meteora DLMM pool.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Price" value={`${pool.price.toFixed(6)} USDC`} />
        <StatTile label={`${TOKEN_SYMBOL} in pool`} value={formatToken(pool.nebReserve, TOKEN_SYMBOL)} />
        <StatTile label="USDC in pool" value={pool.usdcReserve.toFixed(2)} />
      </div>
    </section>
  );
}
