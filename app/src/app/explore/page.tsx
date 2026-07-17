import type { Metadata } from "next";
import { getPlatformStats } from "@/lib/explore";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { ExploreMaps } from "@/components/explore/ExploreMaps";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "See what's happening across nebulous.world — top apps, tag trends, and how apps and tags relate to each other.",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-6">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</div>
      <div className="mt-1 text-heading-xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}

export default async function ExplorePage() {
  const stats = await getPlatformStats();

  return (
    <div className="space-y-16">
      <div>
        <h1 className="text-heading-xl font-semibold text-ink">Explore</h1>
        <p className="mt-2 max-w-2xl text-pretty text-subheading text-slate">
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
        <h2 className="text-heading font-semibold text-ink">Maps</h2>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-slate">
          Two views of how nebulous.world connects — pick a tab, then click a node to see the
          apps behind it.
        </p>
        <div className="mt-6">
          <ExploreMaps />
        </div>
      </section>
    </div>
  );
}
