// Typo-tolerant subsequence matching — same algorithm as the indexer's
// `fuzzy_score`/`fuzzy_match` (indexer/src/handlers/apps.rs, used there for
// app search), ported here so tag suggestions can rank existing tags by
// closeness client-side without a round trip per keystroke. Query
// characters must appear in `text` in order (not necessarily contiguous),
// scored higher for consecutive runs and word-boundary starts — e.g.
// "defi" scores well against both "DeFi" and "de-fi", which is exactly
// what lets a tag picker surface a near-duplicate before the user creates
// one.

/** -1 if `query`'s characters don't all appear in `text`, in order; otherwise higher is closer. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  let score = 0;
  let ti = 0;
  let consecutive = 0;

  for (const ch of q) {
    const foundAt = t.indexOf(ch, ti);
    if (foundAt === -1) return -1;
    const isBoundary = foundAt === 0 || !/[a-z0-9]/i.test(t[foundAt - 1]);
    const isConsecutive = foundAt === ti;
    consecutive = isConsecutive ? consecutive + 1 : 0;
    score += 1 + consecutive * 2 + (isBoundary ? 2 : 0);
    score -= Math.min(foundAt - ti, 5) * 0.2;
    ti = foundAt + 1;
  }
  return score;
}

const MIN_FUZZY_SCORE_PER_CHAR = 1.2;

/** Whether `query` is a "close enough" subsequence match of `text` — an empty query always matches. */
export function fuzzyMatch(text: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return fuzzyScore(text, q) >= q.length * MIN_FUZZY_SCORE_PER_CHAR;
}
