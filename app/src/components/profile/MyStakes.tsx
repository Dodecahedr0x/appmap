"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useTagStakeProgram } from "@/hooks/useTagStakeProgram";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { formatToken } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { apiGet } from "@/lib/txClient";
import type { MyPosition } from "@/lib/indexerClient";

/**
 * Every active vote/tag-stake the signed-in user holds, across every app,
 * with a withdraw button right on the row. Previously the only way to
 * withdraw was to find the exact app (and, for tag stakes, the exact tag)
 * page it was placed on — this is the one place to see and unwind all of
 * them.
 */
export function MyStakes() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { withdrawTagStake } = useTagStakeProgram();
  const { withdrawVote } = useVoteProgram();

  const [positions, setPositions] = useState<MyPosition[] | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  function load() {
    if (!user) {
      setPositions(null);
      return;
    }
    apiGet<{ positions: MyPosition[] }>("/api/profile/positions")
      .then(({ positions }) => setPositions(positions))
      .catch(() => setPositions([]));
  }

  useEffect(load, [user]);

  if (!user || !positions || positions.length === 0) return null;

  async function withdraw(p: MyPosition) {
    setWithdrawingId(p.id);
    try {
      const { txSig, simulated } =
        p.kind === "vote"
          ? await withdrawVote(p.appId, p.amount)
          : await withdrawTagStake(p.appId, p.tagSlug!, p.amount);

      const res = await fetch(p.kind === "vote" ? "/api/vote/withdraw" : "/api/stake/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p.kind === "vote" ? { voteId: p.id } : { stakeId: p.id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Withdraw failed");

      toast.success(
        simulated ? "Withdrawn (simulated)" : "Withdrawn — tokens returned",
        txSig ? { txSig } : undefined,
      );
      setPositions((prev) => (prev ? prev.filter((x) => x.id !== p.id) : prev));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <section className="card space-y-3 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">My stakes</h2>
        <p className="mt-1 text-xs text-slate-steel">
          Every app vote and tag stake you currently hold. Withdraw right here — no need to hunt
          down the app page you placed it on.
        </p>
      </div>
      <ul className="space-y-2">
        {positions.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-hairline p-3"
          >
            <div className="min-w-0">
              <Link href={`/app/${p.appSlug}`} className="font-medium text-ink hover:text-cobalt">
                {p.appName}
              </Link>
              <span className="ml-2 text-xs text-slate-steel">
                {p.kind === "vote" ? "vote" : `stake on #${p.tagName}`} ·{" "}
                {formatToken(p.amount, TOKEN_SYMBOL)}
              </span>
            </div>
            <button
              className="btn-secondary shrink-0 text-xs"
              disabled={withdrawingId === p.id}
              onClick={() => withdraw(p)}
            >
              {withdrawingId === p.id ? "…" : "Withdraw"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
