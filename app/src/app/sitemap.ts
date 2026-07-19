import type { MetadataRoute } from "next";
import { searchApps, fetchTags } from "@/lib/indexerClient";
import { SITE_URL } from "@/lib/constants";

// Server-only, so unlike the public /api/apps route (whose zod schema caps
// pageSize at 50 — see lib/validation.ts's searchSchema) this can ask the
// indexer for every app in one call; indexer/src/handlers/apps.rs's own
// search handler doesn't impose a page_size ceiling of its own.
const MAX_APPS = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/explore`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/rewards`, changeFrequency: "daily", priority: 0.5 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const [{ apps }, { tags }] = await Promise.all([
    searchApps({ q: "", tags: [], fuzzy: "", sort: "new", page: 1, pageSize: MAX_APPS }),
    fetchTags(),
  ]);

  const appRoutes: MetadataRoute.Sitemap = apps.map((app) => ({
    url: `${SITE_URL}/app/${app.slug}`,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  // Long-tail landing pages (see app/tags/[slug]/page.tsx) — only ones with
  // at least one app are worth a crawler's time; an empty tag has no
  // content to rank for yet.
  const tagRoutes: MetadataRoute.Sitemap = tags
    .filter((tag) => tag.appCount > 0)
    .map((tag) => ({
      url: `${SITE_URL}/tags/${tag.slug}`,
      changeFrequency: "daily",
      priority: 0.5,
    }));

  return [...staticRoutes, ...appRoutes, ...tagRoutes];
}
