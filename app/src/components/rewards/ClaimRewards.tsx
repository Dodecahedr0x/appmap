"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useClaimRewards } from "@/hooks/useClaimRewards";
import { ConnectButton } from "@/components/ConnectButton";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { formatToken } from "@/lib/utils";
import { fromRawAmount } from "@/lib/anchorClient";
import { apiGet } from "@/lib/txClient";
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
  tagSlug?: string;
  tagName?: string;
  stakedAmount: number;
  pending: number | null; // null while loading or unavailable
}

/**
 * "Your rewards" — lists every app (and app-tag) the signed-in user has an
 * active vote or stake on, with the pending NEB reward for each and a claim
 * button. Pending amounts only exist on-chain (the DB tracks stake amounts
 * for ranking, never the reward accumulator/checkpoint — see lib/rewards.ts),
 * so this requires a connected wallet and a real (non-simulation) deployment.
 */
export function ClaimRewards() {
  const { user } = useAuth();
  const wallet = useWallet();
  const toast = useToast();
  const { claimVoteReward, claimTagReward } = useClaimRewards();

  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

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
        })),
        ...stakes.map((s) => ({
          key: `tag:${s.appTagId}`,
          kind: "tag" as const,
          appId: s.appId,
          appSlug: s.appSlug,
          appName: s.appName,
          tagSlug: s.tagSlug,
          tagName: s.tagName,
          stakedAmount: s.amount,
          pending: null,
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
              return { ...row, pending: fromRawAmount(pending) };
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
            return { ...row, pending: fromRawAmount(pending) };
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

  async function claim(row: ClaimRow) {
    setClaimingKey(row.key);
    try {
      const { simulated } =
        row.kind === "vote"
          ? await claimVoteReward(row.appId)
          : await claimTagReward(row.appId, row.tagSlug!);

      toast.success(
        simulated
          ? "Claimed (simulated) — running without a live deployment"
          : `Claimed your ${row.appName} reward`,
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

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
          Your rewards
        </h2>
        <p className="mt-1 text-xs text-slate-steel">
          Every vote and tag stake earns a share of that app&apos;s funded {TOKEN_SYMBOL} reward
          pool, on top of your principal — claim anytime without withdrawing your stake.
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

          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-hairline p-3"
              >
                <div>
                  <Link
                    href={`/app/${row.appSlug}`}
                    className="font-medium text-ink hover:text-cobalt"
                  >
                    {row.appName}
                  </Link>
                  <div className="text-xs text-slate-steel">
                    {row.kind === "vote" ? (
                      <>Vote · {formatToken(row.stakedAmount, TOKEN_SYMBOL)} staked</>
                    ) : (
                      <>
                        #{row.tagName} tag · {formatToken(row.stakedAmount, TOKEN_SYMBOL)} staked
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-slate-steel">Pending</div>
                    <div className="font-mono text-sm font-medium text-ink">
                      {row.pending == null ? "—" : formatToken(row.pending, TOKEN_SYMBOL)}
                    </div>
                  </div>
                  <button
                    className="btn-primary py-1.5 text-xs"
                    disabled={
                      claimingKey === row.key ||
                      isSimulationMode() ||
                      !wallet.publicKey ||
                      !row.pending
                    }
                    onClick={() => claim(row)}
                  >
                    {claimingKey === row.key ? "Claiming…" : "Claim"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
