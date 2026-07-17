import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyScore } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an exact substring", () => {
    expect(fuzzyMatch("The Jupiter aggregator", "jupiter")).toBe(true);
  });

  it("matches a typo'd/partial query as a tight subsequence", () => {
    expect(fuzzyMatch("The Jupiter aggregator", "jupitr")).toBe(true);
  });

  it("rejects characters out of order", () => {
    expect(fuzzyMatch("Jupiter", "retipuj")).toBe(false);
  });

  it("rejects a scattered match across unrelated words", () => {
    expect(
      fuzzyMatch(
        "A general purpose onchain routing engine for token swaps",
        "jupiter",
      ),
    ).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(fuzzyMatch("anything at all", "")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("JUPITER AG", "jupiter")).toBe(true);
  });

  it("scores tighter matches higher than looser ones", () => {
    const tight = fuzzyScore("jupiter", "jupiter");
    const loose = fuzzyScore("j u p i t e r spread far apart", "jupiter");
    expect(tight).toBeGreaterThan(loose);
  });

  it("returns -1 when query is not a subsequence at all", () => {
    expect(fuzzyScore("hello", "xyz")).toBe(-1);
  });
});
