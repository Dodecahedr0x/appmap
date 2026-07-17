import type { Metadata } from "next";
import { getPlatformStats } from "@/lib/analytics";
import { searchApps } from "@/lib/search";
import { searchSchema } from "@/lib/validation";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { AppCard } from "@/components/AppCard";
import { TagConstellation } from "@/components/analytics/TagConstellation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Platform-wide stats, top-ranked apps, and a live tag constellation for nebulous.world.",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-6">
      <div className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</div>
      <div className="mt-1 text-heading-xl font-bold text-ink">{value}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const [stats, top] = await Promise.all([
    getPlatformStats(),
    searchApps(searchSchema.parse({ sort: "rank", pageSize: 6 })),
  ]);

  return (
    <div className="space-y-16">
      <div>
        <h1 className="text-heading-xl font-semibold text-ink">Analytics</h1>
        <p className="mt-2 max-w-2xl text-subheading text-slate">
          Platform-wide totals, the current top-ranked apps, and a live map of how tags relate to
          one another across every listed app.
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
        <h2 className="text-heading font-semibold text-ink">Tag constellation</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">
          Each node is a tag, sized by total stake behind it; each edge is how often two tags
          appear together on the same app — a live{" "}
          <span className="font-medium text-ink">d3-force</span> physics simulation, not a static
          chart.
        </p>
        <div className="mt-6">
          <TagConstellation />
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
