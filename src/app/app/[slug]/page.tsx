import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAppDetail } from "@/lib/queries";
import { formatToken, formatNumber, shortAddress, timeAgo } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { VotePanel } from "@/components/app/VotePanel";
import { TagStakePanel } from "@/components/app/TagStakePanel";
import { TrafficBeacon } from "@/components/app/TrafficBeacon";
import { AdSlot } from "@/components/ads/AdSlot";
import { Sparkline } from "@/components/charts/Sparkline";
import { TrendChart } from "@/components/app/TrendChart";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getAppDetail(slug);
  if (!detail) return { title: "App not found — AppMap" };
  return {
    title: `${detail.app.name} — AppMap`,
    description: detail.app.tagline || detail.app.description,
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default async function AppDetailPage({ params }: Props) {
  const { slug } = await params;
  const detail = await getAppDetail(slug);
  if (!detail) notFound();

  const { app, recentVotes, topStakers, viewsLast7d, dailyViews, snapshots } = detail;

  return (
    <div className="space-y-6">
      {/* Records a page view for traffic analytics & revenue attribution. */}
      <TrafficBeacon appId={app.id} path={`/app/${app.slug}`} />

      <Link href="/" className="text-sm text-slate-400 hover:text-white">
        ← Back to discover
      </Link>

      {/* Header */}
      <div className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-overlay text-2xl font-bold text-brand-green">
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            app.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{app.name}</h1>
            <span className="chip capitalize">{app.category}</span>
            <span className="chip capitalize">{app.chain}</span>
          </div>
          <p className="mt-1 text-slate-400">{app.tagline}</p>
        </div>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="btn-primary shrink-0"
        >
          Visit app ↗
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rank score" value={app.rankScore.toFixed(2)} />
            <Stat
              label="Votes"
              value={formatToken(app.voteWeight, "")}
              hint={`${app.voteCount} txns`}
            />
            <Stat label="Total staked" value={formatToken(app.stakeTotal, "")} />
            <Stat
              label="Views"
              value={formatNumber(app.viewCount)}
              hint={`${viewsLast7d} in 7d`}
            />
          </div>

          {/* About */}
          <section className="card p-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              About
            </h2>
            <p className="whitespace-pre-line text-slate-300">{app.description}</p>
          </section>

          {/* Traffic */}
          <section className="card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Traffic (last 7 days)
              </h2>
              <span className="text-sm text-slate-400">
                {formatNumber(viewsLast7d)} views
              </span>
            </div>
            <Sparkline
              data={dailyViews.map((d) => ({ label: d.date.slice(5), value: d.views }))}
            />
          </section>

          {/* Trend history */}
          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Trends
            </h2>
            <TrendChart data={snapshots} />
          </section>

          {/* Tags + staking */}
          <TagStakePanel appId={app.id} tags={app.tags} />

          {/* Recent activity */}
          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Recent votes
            </h2>
            {recentVotes.length === 0 ? (
              <p className="text-sm text-slate-500">
                No votes yet — be the first to vote.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {recentVotes.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-mono text-slate-400">
                      {v.wallet.length > 20 ? shortAddress(v.wallet) : v.wallet}
                    </span>
                    <span className="text-brand-green">
                      +{formatToken(v.amount, TOKEN_SYMBOL)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {timeAgo(v.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <VotePanel appId={app.id} />

          <AdSlot appId={app.id} />

          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Top stakers
            </h2>
            {topStakers.length === 0 ? (
              <p className="text-sm text-slate-500">No stakers yet.</p>
            ) : (
              <ul className="space-y-2">
                {topStakers.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-slate-400">
                      {s.wallet.length > 20 ? shortAddress(s.wallet) : s.wallet}
                    </span>
                    <span className="text-white">
                      {formatToken(s.amount, TOKEN_SYMBOL)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
