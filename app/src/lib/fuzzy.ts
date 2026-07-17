// Lightweight fuzzy substring matching (no external dependency). Used to filter
// apps by their OpenGraph-derived text (tagline/description) against free-form
// user input that may contain typos or skip characters, e.g. "jupitr" should
// still surface "Jupiter".
//
// Algorithm: query characters must appear in `text` in order (a subsequence
// match), scored higher for consecutive runs and matches right after a word
// boundary. This is the same family of heuristic used by fuzzy-finders like
// fzf/Sublime's "Goto Anything", reimplemented small since query strings here
// are short (a few words at most).

/**
 * Score how well `query` fuzzy-matches `text`. Returns -1 if query is not a
 * subsequence of text at all. Otherwise returns a non-negative score where
 * higher means a tighter/more contiguous match.
 */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (q.length === 0) return 0;

  let score = 0;
  let ti = 0;
  let consecutive = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const foundAt = t.indexOf(ch, ti);
    if (foundAt === -1) return -1;

    const isBoundary = foundAt === 0 || /[^a-z0-9]/.test(t[foundAt - 1]);
    const isConsecutive = foundAt === ti;

    consecutive = isConsecutive ? consecutive + 1 : 0;
    score += 1 + consecutive * 2 + (isBoundary ? 2 : 0);

    // Penalize the gap skipped to reach this character, so scattered
    // matches across a long text score lower than tight ones.
    score -= Math.min(foundAt - ti, 5) * 0.2;

    ti = foundAt + 1;
  }

  return score;
}

// Below this, a match is technically a subsequence but too scattered to be a
// meaningful "fuzzy match" for filtering purposes (e.g. a 1-letter overlap in
// a paragraph of text). Threshold scales with query length.
const MIN_SCORE_PER_CHAR = 1.2;

export function fuzzyMatch(text: string, query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return true;
  const score = fuzzyScore(text, q);
  return score >= q.length * MIN_SCORE_PER_CHAR;
}
