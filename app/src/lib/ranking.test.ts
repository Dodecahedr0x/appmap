import { describe, it, expect } from "vitest";
import { computeRankScore, combineSearchScore, ageInDays, RANK_WEIGHTS } from "./ranking";

describe("computeRankScore", () => {
  it("returns the freshness bonus alone for a brand-new app with no activity", () => {
    const score = computeRankScore({ voteWeight: 0, stakeTotal: 0, viewCount: 0, ageDays: 0 });
    expect(score).toBeCloseTo(RANK_WEIGHTS.freshnessBonus, 6);
  });

  it("increases with more votes", () => {
    const low = computeRankScore({ voteWeight: 10, stakeTotal: 0, viewCount: 0, ageDays: 100 });
    const high = computeRankScore({ voteWeight: 1000, stakeTotal: 0, viewCount: 0, ageDays: 100 });
    expect(high).toBeGreaterThan(low);
  });

  it("decays the freshness bonus by half after one half-life", () => {
    const fresh = computeRankScore({ voteWeight: 0, stakeTotal: 0, viewCount: 0, ageDays: 0 });
    const aged = computeRankScore({
      voteWeight: 0,
      stakeTotal: 0,
      viewCount: 0,
      ageDays: RANK_WEIGHTS.freshnessHalfLifeDays,
    });
    expect(aged).toBeCloseTo(fresh / 2, 4);
  });

  it("never goes negative for negative inputs (guards log domain)", () => {
    const score = computeRankScore({ voteWeight: -5, stakeTotal: -5, viewCount: -5, ageDays: 0 });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("combineSearchScore", () => {
  it("returns pure normalized rank when there is no text query", () => {
    expect(combineSearchScore(0, 5, 10)).toBeCloseTo(0.5, 6);
  });

  it("weights text relevance 70% and normalized rank 30% when there is a query", () => {
    const score = combineSearchScore(1, 5, 10);
    expect(score).toBeCloseTo(0.7 * 1 + 0.3 * 0.5, 6);
  });
});

describe("ageInDays", () => {
  it("computes whole days between two dates", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-04T00:00:00Z");
    expect(ageInDays(start, end)).toBeCloseTo(3, 6);
  });
});
