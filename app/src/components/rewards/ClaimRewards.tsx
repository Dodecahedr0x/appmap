"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useClaimRewards } from "@/hooks/useClaimRewards";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { useTagStakeProgram } from "@/hooks/useTagStakeProgram";
import { ConnectButton } from "@/components/ConnectButton";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import { fromRawAmount } from "@/lib/anchorClient";
import { apiGet, apiPost } from "@/lib/txClient";
import { estimateUnstakeFee } from "@/lib/unstakeFee";
import type { AppAccountData, PositionData } from "@/lib/indexerClient";
import { settlePendingRaw } from "@/lib/rewards";

interface VotePositionDTO {
  appId: string;
  appSlug: string;
  appName: string;
  amount: number;
}

interface StakePositionDTO {
  appTagId: string;
  appId: string;
  appSlug: string;
  appName: string;
  tagSlug: string;
  tagName: string;
  amount: number;
}

interface ClaimRow {
  key: string;
  kind: "vote" | "tag";
  appId: string;
  appSlug: string;
  appName: string;
  appTagId?: string;
  tagSlug?: string;
  tagName?: string;
  stakedAmount: number;
  pending: number | null; // null while loading or unavailable
  /** On-chain position's `stakedAt` checkpoint (Unix seconds) — drives the
      early-unstake fee estimate. Only known once the on-chain position is
      fetched below; null until then or if it can't be found. */
  stakedAt: number | null;
}

/**
 * "Your rewards" — lists every app (and app-tag) the signed-in user has an
 * active vote or stake on, with the pending NEB reward for each, a claim
 * button, and an unstake button. Pending amounts only exist on-chain (the DB
 * tracks stake amounts for ranking, never the reward accumulator/checkpoint
 * — see lib/rewards.ts), so those require a connected wallet and a real
 * (non-simulation) deployment. A search box and checkbox-driven bulk actions
 * keep this usable once a wallet has more than a handful of positions —
 * see CloseZeroStakeAccounts for the sequential-loop + tally + one-summary-
 * toast pattern the bulk actions below mirror.
 */
export function ClaimRewards() {
  const { user } = useAuth();
  const wallet = useWallet();
  const toast = useToast();
  const { claimVoteReward, claimTagReward } = useClaimRewards();
  const { withdrawVote } = useVoteProgram();
  const { withdrawTagStake } = useTagStakeProgram();

  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [unstakingKey, setUnstakingKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) {
      setRows(null);
      return;
    }

    let cancelled = false;

    async function load() {
      const res = await fetch("/api/rewards/positions");
      const json = await res.json();
      if (cancelled || !json.ok) return;

      const votes: VotePositionDTO[] = json.data.votes;
      const stakes: StakePositionDTO[] = json.data.stakes;

      const base: ClaimRow[] = [
        ...votes.map((v) => ({
          key: `vote:${v.appId}`,
          kind: "vote" as const,
          appId: v.appId,
          appSlug: v.appSlug,
          appName: v.appName,
          stakedAmount: v.amount,
          pending: null,
          stakedAt: null,
        })),
        ...stakes.map((s) => ({
          key: `tag:${s.appTagId}`,
          kind: "tag" as const,
          appId: s.appId,
          appSlug: s.appSlug,
          appName: s.appName,
          appTagId: s.appTagId,
          tagSlug: s.tagSlug,
          tagName: s.tagName,
          stakedAmount: s.amount,
          pending: null,
          stakedAt: null,
        })),
      ];
      setRows(base);

      if (isSimulationMode() || !wallet.publicKey) return;

      const owner = wallet.publicKey.toBase58();

      const withPending = await Promise.all(
        base.map(async (row) => {
          try {
            const { app } = await apiGet<{ app: AppAccountData | null }>(
              `/api/accounts/app/${encodeURIComponent(row.appId)}`,
            );
            if (!app) return row;
            if (row.kind === "vote") {
              const { position } = await apiGet<{ position: PositionData | null }>(
                `/api/accounts/vote-position/${encodeURIComponent(row.appId)}?owner=${owner}`,
              );
              if (!position) return row;
              const pending = settlePendingRaw(
                new BN(position.amount),
                new BN(position.rewardDebt),
                new BN(app.voteAccRewardPerShare),
              );
              return { ...row, pending: fromRawAmount(pending), stakedAt: position.stakedAt };
            }
            const { position } = await apiGet<{ position: PositionData | null }>(
              `/api/accounts/stake-position/${encodeURIComponent(row.appId)}/${encodeURIComponent(row.tagSlug!)}?owner=${owner}`,
            );
            if (!position) return row;
            const pending = settlePendingRaw(
              new BN(position.amount),
              new BN(position.rewardDebt),
              new BN(app.tagsAccRewardPerShare),
            );
            return { ...row, pending: fromRawAmount(pending), stakedAt: position.stakedAt };
          } catch {
            // Position/app not found on-chain yet (e.g. simulation-mode data
            // with no matching real account) — leave pending unknown rather
            // than erroring the whole list.
            return row;
          }
        }),
      );
      if (!cancelled) setRows(withPending);
    }

    load().catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, wallet.publicKey]);

  const q = query.trim().toLowerCase();
  const filteredRows = (rows ?? []).filter(
    (r) => !q || r.appName.toLowerCase().includes(q) || (r.tagName?.toLowerCase().includes(q) ?? false),
  );
  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.key));
  const someFilteredSelected = filteredRows.some((r) => selected.has(r.key));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filteredRows) next.delete(r.key);
      } else {
        for (const r of filteredRows) next.add(r.key);
      }
      return next;
    });
  }

  async function claim(row: ClaimRow) {
    setClaimingKey(row.key);
    try {
      const { txSig, simulated } =
        row.kind === "vote"
          ? await claimVoteReward(row.appId)
          : await claimTagReward(row.appId, row.tagSlug!);

      toast.success(
        simulated
          ? "Claimed (simulated) — running without a live deployment"
          : `Claimed your ${row.appName} reward`,
        txSig ? { txSig } : undefined,
      );
      setRows((prev) =>
        prev?.map((r) => (r.key === row.key ? { ...r, pending: 0 } : r)) ?? null,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaimingKey(null);
    }
  }

  // Withdraws the FULL principal for this row — the on-chain call takes an
  // arbitrary amount, but `row.stakedAmount` (from /api/rewards/positions)
  // is already the sum of every active Vote/Stake row behind this one
  // on-chain position, so a full withdrawal is the only amount that keeps
  // the DB and on-chain state in sync afterward. The off-chain leg
  // (withdraw-all) retires every one of those summed rows in one call —
  // see indexer/src/handlers/votes.rs / stakes.rs's withdraw_all.
  async function unstake(row: ClaimRow) {
    setUnstakingKey(row.key);
    try {
      const { txSig, simulated } =
        row.kind === "vote"
          ? await withdrawVote(row.appId, row.stakedAmount)
          : await withdrawTagStake(row.appId, row.tagSlug!, row.stakedAmount);

      await apiPost(
        row.kind === "vote" ? "/api/vote/withdraw-all" : "/api/stake/withdraw-all",
        row.kind === "vote" ? { appId: row.appId } : { appTagId: row.appTagId },
      );

      toast.success(
        simulated ? "Unstaked (simulated)" : "Unstaked — tokens returned",
        txSig ? { txSig } : undefined,
      );
      setRows((prev) => prev?.filter((r) => r.key !== row.key) ?? null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.key);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unstake failed");
    } finally {
      setUnstakingKey(null);
    }
  }

  // Bulk actions run sequentially (not Promise.all — each is a wallet
  // signature prompt, and firing 20 at once would be both a bad prompt
  // experience and hard to attribute failures from) and never toast per
  // item — only one summary toast at the end, same shape as
  // CloseZeroStakeAccounts' closeAll().
  async function bulkClaim() {
    const targets = filteredRows.filter((r) => selected.has(r.key) && r.pending);
    if (targets.length === 0) return;
    setBulkBusy(true);
    let claimed = 0;
    let failed = 0;
    const succeeded = new Set<string>();
    for (const row of targets) {
      try {
        if (row.kind === "vote") await claimVoteReward(row.appId);
        else await claimTagReward(row.appId, row.tagSlug!);
        claimed++;
        succeeded.add(row.key);
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setRows((prev) => prev?.map((r) => (succeeded.has(r.key) ? { ...r, pending: 0 } : r)) ?? null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of succeeded) next.delete(key);
      return next;
    });
    if (claimed > 0) {
      toast.success(`Claimed ${claimed} reward${claimed === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`);
    } else {
      toast.error("Couldn't claim any rewards — try again");
    }
  }

  async function bulkUnstake() {
    const targets = filteredRows.filter((r) => selected.has(r.key));
    if (targets.length === 0) return;
    setBulkBusy(true);
    let unstaked = 0;
    let failed = 0;
    const succeeded = new Set<string>();
    for (const row of targets) {
      try {
        if (row.kind === "vote") await withdrawVote(row.appId, row.stakedAmount);
        else await withdrawTagStake(row.appId, row.tagSlug!, row.stakedAmount);
        await apiPost(
          row.kind === "vote" ? "/api/vote/withdraw-all" : "/api/stake/withdraw-all",
          row.kind === "vote" ? { appId: row.appId } : { appTagId: row.appTagId },
        );
        unstaked++;
        succeeded.add(row.key);
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setRows((prev) => prev?.filter((r) => !succeeded.has(r.key)) ?? null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of succeeded) next.delete(key);
      return next;
    });
    if (unstaked > 0) {
      toast.success(
        `Unstaked ${unstaked} position${unstaked === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`,
      );
    } else {
      toast.error("Couldn't unstake any positions — try again");
    }
  }

  const anySelectedClaimable = filteredRows.some((r) => selected.has(r.key) && r.pending);
  const walletReady = isSimulationMode() || !!wallet.publicKey;

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Your rewards
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Every vote and tag stake earns a share of that app&apos;s funded {TOKEN_SYMBOL} reward
          pool, on top of your principal — claim anytime, or unstake to withdraw your principal
          entirely (an early-unstake fee applies in the first week, shrinking to 0).
        </p>
      </div>

      {!user ? (
        <div className="space-y-2">
          <p className="text-sm text-slate">Sign in to see what you can claim.</p>
          <ConnectButton />
        </div>
      ) : rows === null ? (
        <p className="text-sm text-slate">Loading your positions…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate">
          You haven&apos;t voted or staked on any apps yet.{" "}
          <Link href="/" className="font-medium text-cobalt hover:underline">
            Discover an app
          </Link>{" "}
          to start earning rewards.
        </p>
      ) : (
        <>
          {isSimulationMode() ? (
            <p className="rounded-lg border border-hairline bg-ivory p-3 text-xs text-slate-steel">
              Running in simulation mode — pending rewards only exist once votes/stakes are
              settled on a real deployment, so amounts aren&apos;t shown here.
            </p>
          ) : !wallet.publicKey ? (
            <div className="space-y-2 rounded-lg border border-hairline bg-ivory p-3">
              <p className="text-xs text-slate-steel">
                Connect your wallet to see pending rewards for the positions below.
              </p>
              <ConnectButton />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              className="input max-w-xs text-sm"
              placeholder="Search by app or tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search your positions"
            />
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-steel">{selected.size} selected</span>
                <button
                  className="btn-secondary text-xs"
                  disabled={bulkBusy || !!claimingKey || !!unstakingKey || !walletReady}
                  onClick={bulkUnstake}
                >
                  {bulkBusy ? "Working…" : "Unstake selected"}
                </button>
                <button
                  className="btn-primary text-xs"
                  disabled={
                    bulkBusy ||
                    !!claimingKey ||
                    !!unstakingKey ||
                    isSimulationMode() ||
                    !wallet.publicKey ||
                    !anySelectedClaimable
                  }
                  onClick={bulkClaim}
                >
                  {bulkBusy ? "Working…" : "Claim selected"}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {filteredRows.length === 0 ? (
            <p className="text-sm text-slate">No positions match &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[16px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-steel">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
                <span>App / tag</span>
                <span className="text-right">Staked</span>
                <span className="text-right">Pending</span>
                <span />
              </div>
              <ul className="space-y-1">
                {filteredRows.map((row) => {
                  const fee =
                    row.stakedAt != null ? estimateUnstakeFee(row.stakedAmount, row.stakedAt) : null;
                  const busy = claimingKey === row.key || unstakingKey === row.key || bulkBusy;
                  return (
                    <li key={row.key} className="rounded-lg border border-hairline p-2">
                      <div className="grid grid-cols-[16px_minmax(0,1fr)_auto_auto_auto] items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(row.key)}
                          onChange={() => toggleRow(row.key)}
                          aria-label={`Select ${row.appName}${row.kind === "tag" ? ` #${row.tagName}` : ""}`}
                        />
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/app/${row.appSlug}`}
                            className="truncate font-medium text-ink hover:text-cobalt"
                          >
                            {row.appName}
                          </Link>
                          {row.kind === "tag" ? (
                            <Link
                              href={`/tags/${row.tagSlug}`}
                              className="chip chip-active shrink-0 text-[10px]"
                            >
                              #{row.tagName}
                            </Link>
                          ) : (
                            <span className="chip shrink-0 text-[10px]">Vote</span>
                          )}
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums text-slate-steel">
                          {formatToken(row.stakedAmount, TOKEN_SYMBOL)}
                        </div>
                        <div className="text-right font-mono text-xs font-medium tabular-nums text-ink">
                          {row.pending == null ? "—" : formatToken(row.pending, TOKEN_SYMBOL)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="btn-secondary text-xs"
                            disabled={busy || !walletReady}
                            onClick={() => unstake(row)}
                          >
                            {unstakingKey === row.key ? "…" : "Unstake"}
                          </button>
                          <button
                            className="btn-primary text-xs"
                            disabled={busy || isSimulationMode() || !wallet.publicKey || !row.pending}
                            onClick={() => claim(row)}
                          >
                            {claimingKey === row.key ? "…" : "Claim"}
                          </button>
                        </div>
                      </div>
                      {fee && fee.feeBps > 0 && (
                        <p className="mt-1 pl-[28px] text-xs text-slate-steel">
                          {(fee.feeBps / 100).toFixed(2)}% early-unstake fee right now — you&apos;d
                          receive ~{fee.net.toFixed(2)} {TOKEN_SYMBOL}. Shrinks to 0 over a week.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
