"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useTagStakeProgram } from "@/hooks/useTagStakeProgram";
import { useCreateAppProgram } from "@/hooks/useCreateAppProgram";
import { useMountTransition } from "@/hooks/useMountTransition";
import { cn, formatToken, slugify } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { estimateUnstakeFee } from "@/lib/unstakeFee";
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
  const { suggestTag } = useCreateAppProgram();

  const [stakingId, setStakingId] = useState<string | null>(null);
  const { rendered: revealRendered, visible: revealVisible } = useMountTransition(stakingId, 200);
  const [stakeAmount, setStakeAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState("");
  // appTagId -> the current user's active stake on that tag.
  const [myStakes, setMyStakes] = useState<Record<string, { id: string; amount: number }>>({});
  // appTagId -> the on-chain StakePosition's `stakedAt` (Unix seconds) —
  // drives the unstake-fee estimate shown next to each tag's withdraw
  // button. Fetched per-tag since only the indexed on-chain account (not
  // the Postgres `myStakes` row) carries this field.
  const [stakedAtByTag, setStakedAtByTag] = useState<Record<string, number>>({});

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

  useEffect(() => {
    const tagIds = Object.keys(myStakes);
    if (!user || tagIds.length === 0) {
      setStakedAtByTag({});
      return;
    }
    let cancelled = false;
    Promise.all(
      tagIds.map(async (tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        if (!tag) return null;
        try {
          const res = await fetch(
            `/api/accounts/stake-position/${appId}/${tag.slug}?owner=${user.wallet}`,
          );
          const json = await res.json();
          return json.ok && json.data.position
            ? ([tagId, json.data.position.stakedAt as number] as const)
            : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const entry of entries) if (entry) map[entry[0]] = entry[1];
      setStakedAtByTag(map);
    });
    return () => {
      cancelled = true;
    };
  }, [appId, user, myStakes, tags]);

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
        txSig ? { txSig } : undefined,
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
      const { txSig, simulated } = await withdrawTagStake(appId, tagSlug, mine.amount);

      const res = await fetch("/api/stake/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stakeId: mine.id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Withdraw failed");

      toast.success(
        simulated ? "Stake withdrawn (simulated)" : "Stake withdrawn — tokens returned",
        txSig ? { txSig } : undefined,
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

  // Adding a tag is an on-chain `suggest_tag` transaction now (see
  // useCreateAppProgram) — the `Tag`/`AppTag` Postgres rows only show up
  // once the indexer observes it confirmed, same as app creation. There's
  // no synchronous DB write to await here, so `router.refresh()` may not
  // show the new tag immediately; the toast says so rather than implying
  // it's already visible.
  async function suggest() {
    const tagSlug = slugify(newTag);
    if (!tagSlug) return;
    setBusy(true);
    try {
      const txSig = await suggestTag(appId, tagSlug);
      toast.success(`Added #${tagSlug} — indexing…`, { txSig });
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Tags &amp; staking
        </h2>
        <span className="text-xs text-slate-steel">
          Stake backs a tag &amp; earns ad revenue
        </span>
      </div>

      {tags.length === 0 ? (
        <p className="text-sm text-slate-steel">
          No tags yet. Suggest one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {tags.map((t) => (
            <li key={t.id} className="rounded-lg border border-hairline p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Link href={`/tags/${t.slug}`} className="font-medium text-ink hover:text-cobalt">
                    #{t.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-steel">
                    {formatToken(t.stakeTotal, TOKEN_SYMBOL)} staked
                  </span>
                </div>
                {user && myStakes[t.id] && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={() => withdraw(t.id, t.slug)}
                  >
                    {busy ? "…" : `Withdraw ${myStakes[t.id]!.amount}`}
                  </button>
                )}
                {user && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() =>
                      setStakingId(stakingId === t.id ? null : t.id)
                    }
                  >
                    {stakingId === t.id ? "Cancel" : "Stake"}
                  </button>
                )}
              </div>
              {user &&
                myStakes[t.id] &&
                stakedAtByTag[t.id] !== undefined &&
                (() => {
                  const fee = estimateUnstakeFee(myStakes[t.id]!.amount, stakedAtByTag[t.id]!);
                  if (fee.feeBps === 0) return null;
                  return (
                    <p className="mt-1 text-xs text-slate-steel">
                      {(fee.feeBps / 100).toFixed(2)}% early-unstake fee right now — you&apos;d
                      receive ~{fee.net.toFixed(2)} {TOKEN_SYMBOL}. Shrinks to 0 over a week.
                    </p>
                  );
                })()}
              {revealRendered === t.id && (
                <div
                  className={cn(
                    "mt-3 flex items-center gap-2 transition-opacity duration-200 motion-safe:transition-[opacity,transform]",
                    revealVisible
                      ? "opacity-100 motion-safe:translate-y-0"
                      : "opacity-0 motion-safe:-translate-y-1",
                  )}
                >
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
                    className="btn-primary shrink-0 text-sm"
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
        <div className="flex items-center gap-2 border-t border-hairline pt-3">
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
        <p className="border-t border-hairline pt-3 text-xs text-slate-steel">
          Sign in to stake or suggest tags.
        </p>
      )}
    </section>
  );
}
