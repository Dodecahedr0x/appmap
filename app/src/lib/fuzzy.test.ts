import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyScore } from "./fuzzy";

// Same assertions as indexer/src/handlers/apps.rs's fuzzy_match tests —
// this is a client-side port of that exact algorithm, kept behaviorally
// identical.
describe("fuzzyMatch", () => {
  it("matches an exact substring", () => {
    expect(fuzzyMatch("The Jupiter aggregator", "jupiter")).toBe(true);
  });

  it("matches a typo'd partial query as a tight subsequence", () => {
    expect(fuzzyMatch("The Jupiter aggregator", "jupitr")).toBe(true);
  });

  it("rejects characters out of order", () => {
    expect(fuzzyMatch("Jupiter", "retipuj")).toBe(false);
  });

  it("rejects a scattered match across unrelated words", () => {
    expect(fuzzyMatch("A general purpose onchain routing engine for token swaps", "jupiter")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(fuzzyMatch("anything at all", "")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(fuzzyMatch("JUPITER AG", "jupiter")).toBe(true);
  });

  it("finds a punctuation-free query as a subsequence of punctuated text", () => {
    // The reverse (a query containing "-" against unpunctuated text) does
    // NOT match here — a hyphen in the query is a literal character to
    // search for, same as the Rust original. TagAutocomplete's `fuzzy`
    // mode strips punctuation from both sides before scoring specifically
    // to make tag-duplicate detection symmetric either way.
    expect(fuzzyMatch("de-fi", "defi")).toBe(true);
  });
});

describe("fuzzyScore", () => {
  it("scores tighter matches higher than looser ones", () => {
    const tight = fuzzyScore("defi", "defi");
    const loose = fuzzyScore("decentralized finance", "defi");
    expect(tight).toBeGreaterThan(loose);
  });

  it("returns -1 when not a subsequence", () => {
    expect(fuzzyScore("defi", "nft")).toBe(-1);
  });
});
