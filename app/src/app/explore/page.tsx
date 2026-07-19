import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { ExploreMaps } from "@/components/explore/ExploreMaps";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Explore",
  description: "Browse nebulous.world by tag, or click through the app, tag, and group maps to see how everything connects.",
  alternates: { canonical: `${SITE_URL}/explore` },
};

// Platform-wide activity metrics used to live here — moved to the Rewards
// page (see components/rewards/PlatformMetrics.tsx), which is where the
// product's other "read the numbers" surfaces (pool analytics) already
// live. This page is just the maps now: pick a tag/tab up top, click a node
// to see the apps behind it below — the same selector-then-results shape as
// the Discover page, just browsing by tag/connection instead of by search.
export default function ExplorePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Explore"
        description="Browse by tag, or click through the app, tag, and group maps to see how nebulous.world connects."
      />

      <ExploreMaps />
    </div>
  );
}
