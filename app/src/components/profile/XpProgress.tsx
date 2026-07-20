"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { ConnectButton } from "@/components/ConnectButton";
import type { UserXp, XpActivityEntry } from "@/lib/indexerClient";

function describeEvent(event: XpActivityEntry): string {
  switch (event.kind) {
    case "submit_app":
      return `Submitted ${event.appName ?? "an app"}`;
    case "suggest_tag":
      return `Suggested #${event.tagName ?? "a tag"} on ${event.appName ?? "an app"}`;
    case "vote":
      return `Voted on ${event.appName ?? "an app"}`;
    case "stake":
      return `Staked on #${event.tagName ?? "a tag"} (${event.appName ?? "an app"})`;
    case "daily_bonus":
      return "Daily bonus";
    default:
      return event.kind;
  }
}

export function XpProgress() {
  const { user } = useAuth();
  const [xp, setXp] = useState<UserXp | null | undefined>(undefined);
  const [activity, setActivity] = useState<XpActivityEntry[] | null>(null);

  useEffect(() => {
    if (!user) {
      setXp(null);
      setActivity(null);
      return;
    }

    let cancelled = false;

    async function load() {
      const [xpRes, activityRes] = await Promise.all([
        fetch("/api/xp/me").then((r) => r.json()),
        fetch("/api/xp/me/activity").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (xpRes.ok) setXp(xpRes.data);
      if (activityRes.ok) setActivity(activityRes.data);
    }

    load().catch(() => {
      if (!cancelled) {
        setXp(null);
        setActivity([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <section className="card space-y-3 p-6">
        <p className="text-sm text-slate">Sign in to see your level and activity.</p>
        <ConnectButton />
      </section>
    );
  }

  if (xp === undefined) {
    return (
      <section className="card p-6">
        <p className="text-sm text-slate">Loading your profile…</p>
      </section>
    );
  }

  if (xp === null) {
    return (
      <section className="card p-6">
        <p className="text-sm text-slate">Couldn&apos;t load your profile. Try refreshing.</p>
      </section>
    );
  }

  const pct = Math.round(xp.progress * 100);

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <span className="chip chip-active font-mono tabular-nums">
            Lv {xp.level} · {xp.title}
          </span>
          <span className="font-mono text-xs tabular-nums text-slate-steel">
            {xp.xpIntoLevel} / {xp.xpForNextLevel} XP
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-pill bg-mist">
          <div
            className="h-full rounded-pill bg-cobalt transition-[width] duration-[250ms] ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Apps submitted" value={xp.appsSubmitted} />
          <Stat label="Tags suggested" value={xp.tagsSuggested} />
          <Stat label="Votes cast" value={xp.votesCast} />
          <Stat label="Tags staked" value={xp.stakesMade} />
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">Activity</h2>
        {activity === null ? (
          <p className="text-sm text-slate">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-slate">
            No activity yet.{" "}
            <Link href="/" className="font-medium text-cobalt hover:underline">
              Discover an app
            </Link>{" "}
            to start earning XP.
          </p>
        ) : (
          <ul className="space-y-2">
            {activity.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-hairline p-3"
              >
                <span className="text-sm text-ink">{describeEvent(event)}</span>
                <span className="font-mono text-xs tabular-nums text-forest">+{event.amount} XP</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-steel">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
