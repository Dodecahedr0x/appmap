"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { useTagStakeProgram } from "@/hooks/useTagStakeProgram";
import { ConnectButton } from "@/components/ConnectButton";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import { apiGet, apiPost } from "@/lib/txClient";
import { estimateUnstakeFee } from "@/lib/unstakeFee";
import type { PositionData } from "@/lib/indexerClient";
import { UnstakeFeeNotice } from "@/components/UnstakeFeeNotice";

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

interface StakeRow {
  key: string;
  kind: "vote" | "tag";
  appId: string;
  appSlug: string;
  appName: string;
  appTagId?: string;
  tagSlug?: string;
  tagName?: string;
  stakedAmount: number;
  /** On-chain position's `stakedAt` checkpoint — drives the early-unstake
      fee notice below. Only known once fetched (real deployment + connected
      wallet); null otherwise, which just hides the notice. */
  stakedAt: number | null;
}

/**
 * "Your stakes" — every app vote and tag stake the signed-in user currently
 * has open, in one compact, scrollable list so it can sit on the Profile
 * page without pushing everything else below the fold (unlike ClaimRewards
 * on the Rewards page, which is the fuller claim/search/bulk-action
 * workspace this deliberately doesn't duplicate — see the link at the
 * bottom). Same `/api/rewards/positions` data source as ClaimRewards, but
 * skips its pending-reward on-chain fetch entirely (that's a claim-specific
 * concern); the one on-chain read this does make is `stakedAt`, cheap and
 * needed either way to show the early-unstake fee before someone commits to
 * unstaking from here.
 */
export function MyStakes() {
  const { user } = useAuth();
  const wallet = useWallet();
  const toast = useToast();
  const { withdrawVote } = useVoteProgram();
  const { withdrawTagStake } = useTagStakeProgram();

  const [rows, setRows] = useState<StakeRow[] | null>(null);
  const [unstakingKey, setUnstakingKey] = useState<string | null>(null);

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

      const base: StakeRow[] = [
        ...votes.map((v) => ({
          key: `vote:${v.appId}`,
          kind: "vote" as const,
          appId: v.appId,
          appSlug: v.appSlug,
          appName: v.appName,
          stakedAmount: v.amount,
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
          stakedAt: null,
        })),
      ];
      setRows(base);

      if (isSimulationMode() || !wallet.publicKey) return;

      const owner = wallet.publicKey.toBase58();
      const withStakedAt = await Promise.all(
        base.map(async (row) => {
          try {
            const path =
              row.kind === "vote"
                ? `/api/accounts/vote-position/${encodeURIComponent(row.appId)}?owner=${owner}`
                : `/api/accounts/stake-position/${encodeURIComponent(row.appId)}/${encodeURIComponent(row.tagSlug!)}?owner=${owner}`;
            const { position } = await apiGet<{ position: PositionData | null }>(path);
            return position ? { ...row, stakedAt: position.stakedAt } : row;
          } catch {
            // Position not found on-chain yet (e.g. simulation-seeded data
            // with no matching real account) — leave the fee notice hidden
            // rather than erroring the whole list.
            return row;
          }
        }),
      );
      if (!cancelled) setRows(withStakedAt);
    }

    load().catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, wallet.publicKey]);

  const walletReady = isSimulationMode() || !!wallet.publicKey;

  // Withdraws the FULL principal for this row, same reasoning as
  // ClaimRewards' unstake(): `row.stakedAmount` is already the sum of every
  // active Vote/Stake row behind this on-chain position, and the off-chain
  // withdraw-all call retires all of them together.
  async function unstake(row: StakeRow) {
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unstake failed");
    } finally {
      setUnstakingKey(null);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">Your stakes</h2>
        <Link href="/rewards" className="text-xs font-medium text-cobalt hover:underline">
          Claim rewards →
        </Link>
      </div>

      {!user ? (
        <div className="space-y-2">
          <p className="text-sm text-slate">Sign in to see and manage your stakes.</p>
          <ConnectButton />
        </div>
      ) : rows === null ? (
        <p className="text-sm text-slate">Loading your stakes…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate">
          You haven&apos;t voted or staked on any apps yet.{" "}
          <Link href="/" className="font-medium text-cobalt hover:underline">
            Discover an app
          </Link>{" "}
          to get started.
        </p>
      ) : (
        // Capped height + scroll is the whole point: a wallet with a dozen+
        // positions must not push the rest of the Profile page below the
        // fold — see this component's own doc comment.
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const fee = row.stakedAt != null ? estimateUnstakeFee(row.stakedAmount, row.stakedAt) : null;
            const busy = unstakingKey === row.key;
            return (
              <li key={row.key} className="rounded-lg border border-hairline p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Link
                      href={`/app/${row.appSlug}`}
                      className="truncate text-sm font-medium text-ink hover:text-cobalt"
                    >
                      {row.appName}
                    </Link>
                    {row.kind === "tag" ? (
                      <Link href={`/tags/${row.tagSlug}`} className="chip chip-active shrink-0 text-[10px]">
                        #{row.tagName}
                      </Link>
                    ) : (
                      <span className="chip shrink-0 text-[10px]">Vote</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-slate-steel">
                      {formatToken(row.stakedAmount, TOKEN_SYMBOL)}
                    </span>
                    <button
                      className="btn-secondary text-xs"
                      disabled={busy || !walletReady}
                      onClick={() => unstake(row)}
                    >
                      {busy ? "…" : "Unstake"}
                    </button>
                  </div>
                </div>
                {fee && (
                  <div className="mt-1">
                    <UnstakeFeeNotice feeBps={fee.feeBps} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
