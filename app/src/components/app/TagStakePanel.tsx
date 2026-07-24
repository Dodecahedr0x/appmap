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
  // Tag whose partial-withdrawal input is currently open.
  const [withdrawPendingId, setWithdrawPendingId] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
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

  // `amount` omitted (or >= the full stake) withdraws everything; a smaller
  // value does a partial withdrawal, mirroring withdraw_tag_stake's on-chain
  // `amount` param (see that instruction's handler — it reduces
  // StakePosition.amount rather than closing the position).
  async function withdraw(appTagId: string, tagSlug: string, amount?: number) {
    const mine = myStakes[appTagId];
    if (!mine) return;
    const withdrawAmount = amount !== undefined ? Math.min(amount, mine.amount) : mine.amount;
    if (withdrawAmount <= 0) return;
    const isFull = withdrawAmount >= mine.amount;
    setBusy(true);
    try {
      const { txSig, simulated } = await withdrawTagStake(appId, tagSlug, withdrawAmount);

      const res = await fetch("/api/stake/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stakeId: mine.id, amount: isFull ? undefined : withdrawAmount }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Withdraw failed");

      toast.success(
        simulated ? "Stake withdrawn (simulated)" : "Stake withdrawn — tokens returned",
        txSig ? { txSig } : undefined,
      );
      setMyStakes((prev) => {
        const next = { ...prev };
        if (isFull) {
          delete next[appTagId];
        } else {
          next[appTagId] = { ...next[appTagId], amount: next[appTagId].amount - withdrawAmount };
        }
        return next;
      });
      setWithdrawPendingId(null);
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

            <li key={t.id} className="rounded-lg border border-hairline p-2">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/tags/${t.slug}`} className="truncate text-xs font-medium text-ink hover:text-cobalt">
                  #{t.name}
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  {user && myStakes[t.id] && (
                    <button
                      className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-medium text-ink transition-colors hover:bg-mist disabled:opacity-60"
                      disabled={busy}
                      onClick={() => {
                        if (withdrawPendingId === t.id) {
                          setWithdrawPendingId(null);
                        } else {
                          setWithdrawPendingId(t.id);
                          setWithdrawAmount(myStakes[t.id]!.amount);
                        }
                      }}
                    >
                      {withdrawPendingId === t.id ? "Cancel" : "Withdraw"}
                    </button>
                  )}
                  {user && (
                    <button
                      className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-medium text-ink transition-colors hover:bg-mist"
                      onClick={() => setStakingId(stakingId === t.id ? null : t.id)}
                    >
                      {stakingId === t.id ? "Cancel" : "Stake"}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-steel">
                {formatToken(t.stakeTotal, "")}
                {user && myStakes[t.id] && ` (${formatToken(myStakes[t.id]!.amount, "")})`} {TOKEN_SYMBOL}
              </p>
              {user && myStakes[t.id] && withdrawPendingId === t.id && (
                <div className="mt-1.5 rounded-md bg-mist p-2">
                  {stakedAtByTag[t.id] !== undefined &&
                    (() => {
                      const fee = estimateUnstakeFee(withdrawAmount, stakedAtByTag[t.id]!);
                      return (
                        <div
                          className="inline-flex items-center gap-1 text-[11px] text-slate-steel"
                          title="The early-unstake fee starts at 1% and decays linearly to 0% over the week after you staked."
                        >
                          <span>{fee.feeBps === 0 ? "No fee" : `${(fee.feeBps / 100).toFixed(2)}% fee`}</span>
                          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-hairline text-[9px] leading-none text-slate-steel">
                            i
                          </span>
                        </div>
                      );
                    })()}
                  <div className="mt-1.5 flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={myStakes[t.id]!.amount}
                      step="any"
                      className="input text-xs"
                      value={withdrawAmount}
                      onChange={(e) =>
                        setWithdrawAmount(Math.max(0, Math.min(myStakes[t.id]!.amount, Number(e.target.value))))
                      }
                      aria-label="Withdraw amount"
                    />
                    <button
                      className="btn-primary shrink-0 px-2 py-0.5 text-[11px]"
                      disabled={busy || withdrawAmount <= 0}
                      onClick={() => withdraw(t.id, t.slug, withdrawAmount)}
                    >
                      {busy ? "…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
              {revealRendered === t.id && (
                <div
                  className={cn(
                    "mt-1.5 flex items-center gap-1.5 transition-opacity duration-200 motion-safe:transition-[opacity,transform]",
                    revealVisible
                      ? "opacity-100 motion-safe:translate-y-0"
                      : "opacity-0 motion-safe:-translate-y-1",
                  )}
                >
                  <input
                    type="number"
                    min={1}
                    className="input text-xs"
                    value={stakeAmount}
                    onChange={(e) =>
                      setStakeAmount(Math.max(0, Number(e.target.value)))
                    }
                    aria-label="Stake amount"
                  />
                  <button
                    className="btn-primary shrink-0 px-2 py-0.5 text-[11px]"
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
