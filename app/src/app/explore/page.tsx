import type { Metadata } from "next";
import { getPlatformStats } from "@/lib/explore";
import { searchApps } from "@/lib/search";
import { searchSchema } from "@/lib/validation";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { AppCard } from "@/components/AppCard";
import { TagMap } from "@/components/explore/TagMap";
import { AppMap } from "@/components/explore/AppMap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "See what's happening across nebulous.world — top apps, tag trends, and how apps and tags relate to each other.",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-6">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</div>
      <div className="mt-1 text-heading-xl font-bold text-ink">{value}</div>
    </div>
  );
}

export default async function ExplorePage() {
  const [stats, top] = await Promise.all([
    getPlatformStats(),
    searchApps(searchSchema.parse({ sort: "rank", pageSize: 6 })),
  ]);

  return (
    <div className="space-y-16">
      <div>
        <h1 className="text-heading-xl font-semibold text-ink">Explore</h1>
        <p className="mt-2 max-w-2xl text-subheading text-slate">
          A closer look at what&apos;s happening across nebulous.world: who the community is
          backing, which apps are worth a look, and how it all connects.
        </p>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Apps" value={formatNumber(stats.totalApps)} />
          <StatTile label="Tags" value={formatNumber(stats.totalTags)} />
          <StatTile label="Votes cast" value={formatToken(stats.totalVoteWeight, TOKEN_SYMBOL)} />
          <StatTile label="Staked" value={formatToken(stats.totalStake, TOKEN_SYMBOL)} />
          <StatTile label="Page views" value={formatNumber(stats.totalViews)} />
        </div>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink">Similar apps</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">
          Apps cluster together when they&apos;re tagged alike — a quick way to find something
          close to an app you already use. Click any circle to open that app.
        </p>
        <div className="mt-6">
          <AppMap />
        </div>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink">Tags that travel together</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">
          Bigger circles have more stake behind them. Tags placed close together tend to show up
          on the same apps — a way to browse by theme instead of by keyword.
        </p>
        <div className="mt-6">
          <TagMap />
        </div>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink">Top ranked</h2>
        <p className="mt-1 text-sm text-slate">
          By the same open ranking formula every app is sorted by everywhere else on the site.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {top.apps.map((app, i) => (
            <AppCard key={app.id} app={app} rank={i + 1} />
          ))}
        </div>
      </section>
    </div>
  );
}
