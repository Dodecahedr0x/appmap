"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useTagStakeProgram } from "@/hooks/useTagStakeProgram";
import { formatToken } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import type { TagDTO } from "@/lib/types";

/**
 * Tags + staking. Shows each tag with its total stake, lets signed-in users
 * stake tokens behind a tag (settled on-chain in production), and lets anyone
 * suggest a new tag for the app.
 */
export function TagStakePanel({
  appId,
  tags,
}: {
  appId: string;
  tags: TagDTO[];
}) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { stakeTag, withdrawTagStake } = useTagStakeProgram();

  const [stakingId, setStakingId] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState("");
  // appTagId -> the current user's active stake on that tag.
  const [myStakes, setMyStakes] = useState<Record<string, { id: string; amount: number }>>({});

  useEffect(() => {
    if (!user) {
      setMyStakes({});
      return;
    }
    fetch(`/api/stake?appId=${appId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) return;
        const byTag: Record<string, { id: string; amount: number }> = {};
        for (const s of json.data.stakes as { id: string; amount: number; appTagId: string }[]) {
          byTag[s.appTagId] = { id: s.id, amount: s.amount };
        }
        setMyStakes(byTag);
      })
      .catch(() => {});
  }, [appId, user]);

  async function stake(appTagId: string, tagSlug: string) {
    if (stakeAmount <= 0) return;
    setBusy(true);
    try {
      const { txSig, simulated } = await stakeTag(appId, tagSlug, stakeAmount);
      const res = await fetch("/api/stake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appTagId, amount: stakeAmount, txSig: txSig ?? undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Stake failed");
      toast.success(
        simulated
          ? `Staked ${stakeAmount} ${TOKEN_SYMBOL} (simulated)`
          : `Staked ${stakeAmount} ${TOKEN_SYMBOL}`,
      );
      setStakingId(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stake failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(appTagId: string, tagSlug: string) {
    const mine = myStakes[appTagId];
    if (!mine) return;
    setBusy(true);
    try {
      const { simulated } = await withdrawTagStake(appId, tagSlug, mine.amount);

      const res = await fetch("/api/stake/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stakeId: mine.id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Withdraw failed");

      toast.success(
        simulated ? "Stake withdrawn (simulated)" : "Stake withdrawn — tokens returned",
      );
      setMyStakes((prev) => {
        const next = { ...prev };
        delete next[appTagId];
        return next;
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    const tag = newTag.trim();
    if (!tag) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tags/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, tag }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not add tag");
      toast.success(`Added #${tag}`);
      setNewTag("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add tag");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Tags &amp; staking
        </h2>
        <span className="text-xs text-slate-500">
          Stake backs a tag &amp; earns ad revenue
        </span>
      </div>

      {tags.length === 0 ? (
        <p className="text-sm text-slate-500">
          No tags yet. Suggest one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {tags.map((t) => (
            <li key={t.id} className="rounded-lg border border-surface-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-white">#{t.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {formatToken(t.stakeTotal, TOKEN_SYMBOL)} staked
                  </span>
                </div>
                {user && myStakes[t.id] && (
                  <button
                    className="btn-secondary py-1 text-xs"
                    disabled={busy}
                    onClick={() => withdraw(t.id, t.slug)}
                  >
                    {busy ? "…" : `Withdraw ${myStakes[t.id]!.amount}`}
                  </button>
                )}
                {user && (
                  <button
                    className="btn-secondary py-1 text-xs"
                    onClick={() =>
                      setStakingId(stakingId === t.id ? null : t.id)
                    }
                  >
                    {stakingId === t.id ? "Cancel" : "Stake"}
                  </button>
                )}
              </div>
              {stakingId === t.id && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={stakeAmount}
                    onChange={(e) =>
                      setStakeAmount(Math.max(0, Number(e.target.value)))
                    }
                    aria-label="Stake amount"
                  />
                  <button
                    className="btn-primary shrink-0 py-1.5 text-sm"
                    disabled={busy}
                    onClick={() => stake(t.id, t.slug)}
                  >
                    {busy ? "…" : "Confirm"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {user ? (
        <div className="flex items-center gap-2 border-t border-surface-border pt-3">
          <input
            className="input"
            placeholder="Suggest a tag (e.g. lending)"
            value={newTag}
            maxLength={40}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && suggest()}
          />
          <button
            className="btn-secondary shrink-0"
            disabled={busy || !newTag.trim()}
            onClick={suggest}
          >
            Add
          </button>
        </div>
      ) : (
        <p className="border-t border-surface-border pt-3 text-xs text-slate-500">
          Sign in to stake or suggest tags.
        </p>
      )}
    </section>
  );
}
