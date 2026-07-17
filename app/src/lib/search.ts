import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { appInclude, serializeApp } from "./serialize";
import { combineSearchScore } from "./ranking";
import { AppStatus } from "./constants";
import { fuzzyMatch } from "./fuzzy";
import type { SearchInput } from "./validation";
import type { AppDTO, SearchResult } from "./types";

// Advanced search + ranking.
//
// SQLite has no first-class full-text index we can drive through Prisma, so we
// filter candidate rows in the database (status, stake/view ranges, tag, and a
// coarse LIKE on the query) and then compute a precise relevance score plus
// the remaining range/fuzzy filters in JS, combined with each app's cached
// rank score for final ordering.

/** Tokenise a free-text query into lowercase terms. */
function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Compute a 0..1 text relevance score for an app against query terms. Field
 * weighting: name > tagline > tags > description. Exact and prefix matches on
 * the name are boosted so "jup" surfaces "Jupiter" strongly.
 */
export function textRelevance(app: AppDTO, terms: string[]): number {
  if (terms.length === 0) return 0;
  const name = app.name.toLowerCase();
  const tagline = app.tagline.toLowerCase();
  const description = app.description.toLowerCase();
  const tagText = app.tags.map((t) => t.name.toLowerCase()).join(" ");

  let score = 0;
  for (const term of terms) {
    if (name === term) score += 5;
    else if (name.startsWith(term)) score += 3;
    else if (name.includes(term)) score += 2;

    if (tagline.includes(term)) score += 1.2;
    if (tagText.includes(term)) score += 1;
    if (description.includes(term)) score += 0.5;
  }
  // Normalise to 0..1 by the theoretical max for the query length.
  const maxPerTerm = 5 + 1.2 + 1 + 0.5;
  return Math.min(1, score / (terms.length * maxPerTerm));
}

function buildWhere(input: SearchInput): Prisma.AppWhereInput {
  const where: Prisma.AppWhereInput = { status: AppStatus.APPROVED };

  if (input.appStakeMin !== undefined || input.appStakeMax !== undefined) {
    where.stakeTotal = {
      ...(input.appStakeMin !== undefined && { gte: input.appStakeMin }),
      ...(input.appStakeMax !== undefined && { lte: input.appStakeMax }),
    };
  }

  if (input.pageviewsMin !== undefined || input.pageviewsMax !== undefined) {
    where.viewCount = {
      ...(input.pageviewsMin !== undefined && { gte: input.pageviewsMin }),
      ...(input.pageviewsMax !== undefined && { lte: input.pageviewsMax }),
    };
  }

  if (input.tags && input.tags.length > 0) {
    // App must carry every selected tag (AND semantics across facets).
    where.AND = input.tags.map((slug) => ({
      appTags: { some: { tag: { slug } } },
    }));
  }

  const terms = tokenize(input.q);
  if (terms.length > 0) {
    // Coarse candidate filter: any term appears in name/tagline/description or
    // a tag name. Precise scoring happens in JS afterwards.
    where.OR = terms.flatMap((term) => [
      { name: { contains: term } },
      { tagline: { contains: term } },
      { description: { contains: term } },
      { appTags: { some: { tag: { name: { contains: term } } } } },
    ]);
  }

  return where;
}

function sortComparator(
  sort: SearchInput["sort"],
  maxRank: number,
  terms: string[],
): (a: AppDTO, b: AppDTO) => number {
  switch (sort) {
    case "votes":
      return (a, b) => b.voteWeight - a.voteWeight;
    case "stake":
      return (a, b) => b.stakeTotal - a.stakeTotal;
    case "traffic":
      return (a, b) => b.viewCount - a.viewCount;
    case "new":
      return (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt);
    case "rank":
    default:
      return (a, b) => {
        const sa = combineSearchScore(
          textRelevance(a, terms),
          a.rankScore,
          maxRank,
        );
        const sb = combineSearchScore(
          textRelevance(b, terms),
          b.rankScore,
          maxRank,
        );
        return sb - sa;
      };
  }
}

/**
 * The "tags stake" of an app for filtering purposes: when tags are selected,
 * the stake behind those specific tags (summed); otherwise the app's single
 * strongest tag, so the filter means something even with no tags picked.
 */
function tagsStakeValue(app: AppDTO, selectedTags: string[]): number {
  if (selectedTags.length > 0) {
    return app.tags
      .filter((t) => selectedTags.includes(t.slug))
      .reduce((sum, t) => sum + t.stakeTotal, 0);
  }
  return app.tags.reduce((max, t) => Math.max(max, t.stakeTotal), 0);
}

function inRange(value: number, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Run a search. Returns a page of apps plus facet counts computed over the full
 * (unpaginated) filtered set so the UI can render accurate filter badges.
 */
export async function searchApps(input: SearchInput): Promise<SearchResult> {
  const where = buildWhere(input);
  const terms = tokenize(input.q);

  const rows = await prisma.app.findMany({ where, include: appInclude });
  let apps = rows.map(serializeApp);

  // When there's a query, drop apps that don't actually match after scoring
  // (the DB filter is intentionally loose but JS scoring is authoritative).
  if (terms.length > 0) {
    apps = apps.filter((a) => textRelevance(a, terms) > 0);
  }

  if (input.tagsCountMin !== undefined || input.tagsCountMax !== undefined) {
    apps = apps.filter((a) =>
      inRange(a.tags.length, input.tagsCountMin, input.tagsCountMax),
    );
  }

  if (input.tagsStakeMin !== undefined || input.tagsStakeMax !== undefined) {
    apps = apps.filter((a) =>
      inRange(tagsStakeValue(a, input.tags), input.tagsStakeMin, input.tagsStakeMax),
    );
  }

  // Fuzzy-match against the OpenGraph-derived text (name/tagline/description),
  // distinct from the coarse substring search above.
  const fuzzy = input.fuzzy.trim();
  if (fuzzy.length > 0) {
    apps = apps.filter((a) =>
      fuzzyMatch(`${a.name} ${a.tagline} ${a.description}`, fuzzy),
    );
  }

  const maxRank = apps.reduce((m, a) => Math.max(m, a.rankScore), 0);
  apps.sort(sortComparator(input.sort, maxRank, terms));

  const total = apps.length;
  const facets = computeFacets(apps);

  const start = (input.page - 1) * input.pageSize;
  const paged = apps.slice(start, start + input.pageSize);

  return { apps: paged, total, page: input.page, pageSize: input.pageSize, facets };
}

function computeFacets(apps: AppDTO[]): SearchResult["facets"] {
  const tags = new Map<string, { name: string; count: number }>();

  for (const app of apps) {
    for (const t of app.tags) {
      const entry = tags.get(t.slug) ?? { name: t.name, count: 0 };
      entry.count += 1;
      tags.set(t.slug, entry);
    }
  }

  return {
    tags: [...tags.entries()]
      .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
  };
}
