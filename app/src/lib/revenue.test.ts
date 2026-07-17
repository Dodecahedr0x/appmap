import { describe, it, expect } from "vitest";
import { distributeAppRevenue, distributeRevenue, revenuePerImpression } from "./revenue";

describe("distributeRevenue", () => {
  it("splits pro-rata by stake after taking the protocol fee", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 75 },
      { userId: "b", stake: 25 },
    ]);
    expect(result.protocolFee).toBeCloseTo(10, 6);
    expect(result.distributable).toBeCloseTo(90, 6);
    expect(result.shares.find((s) => s.userId === "a")!.amount).toBeCloseTo(67.5, 6);
    expect(result.shares.find((s) => s.userId === "b")!.amount).toBeCloseTo(22.5, 6);
  });

  it("sums shares to exactly the distributable amount (no rounding dust)", () => {
    const result = distributeRevenue(10, [
      { userId: "a", stake: 1 },
      { userId: "b", stake: 1 },
      { userId: "c", stake: 1 },
    ]);
    const total = result.shares.reduce((sum, s) => sum + s.amount, 0);
    expect(total).toBeCloseTo(result.distributable, 9);
  });

  it("aggregates multiple positions from the same user", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 50 },
      { userId: "a", stake: 50 },
    ]);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]!.amount).toBeCloseTo(90, 6);
  });

  it("returns everything as undistributed when there are no active stakers", () => {
    const result = distributeRevenue(100, []);
    expect(result.shares).toHaveLength(0);
    expect(result.undistributed).toBeCloseTo(90, 6);
  });

  it("ignores zero/negative stake positions", () => {
    const result = distributeRevenue(100, [
      { userId: "a", stake: 10 },
      { userId: "b", stake: 0 },
      { userId: "c", stake: -5 },
    ]);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]!.userId).toBe("a");
    // "a" should get the full distributable amount, undiluted by the
    // excluded positions' stake.
    expect(result.shares[0]!.amount).toBeCloseTo(90, 6);
  });

  it("respects a custom fee rate", () => {
    const result = distributeRevenue(100, [{ userId: "a", stake: 10 }], 0.5);
    expect(result.protocolFee).toBeCloseTo(50, 6);
    expect(result.distributable).toBeCloseTo(50, 6);
    expect(result.shares[0]!.amount).toBeCloseTo(50, 6);
  });
});

describe("revenuePerImpression", () => {
  it("divides cpm by 1000", () => {
    expect(revenuePerImpression(2.5)).toBeCloseTo(0.0025, 9);
  });
});

describe("distributeAppRevenue", () => {
  it("splits the distributable amount 50/50 between vote and tag pools", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [{ userId: "voter", stake: 10 }],
      tagPositions: [{ userId: "tagger", stake: 10 }],
    });
    // fee 10% of 200 = 20, distributable 180, split 90/90
    expect(result.gross).toBeCloseTo(200, 6);
    expect(result.protocolFee).toBeCloseTo(20, 6);
    expect(result.votePool.distributable).toBeCloseTo(90, 6);
    expect(result.tagPool.distributable).toBeCloseTo(90, 6);
  });

  it("exposes the combined fee at the top level even though the inner pools show a zero fee", () => {
    // The fee is taken once, up front, on the combined gross — the inner
    // distributeRevenue calls run with feeRate=0 so it isn't double-charged.
    // A caller auditing total fee revenue must read the top-level field,
    // not sum the (zeroed) inner pool fees.
    const result = distributeAppRevenue(200, {
      votePositions: [{ userId: "voter", stake: 10 }],
      tagPositions: [{ userId: "tagger", stake: 10 }],
    });
    expect(result.protocolFee).toBeCloseTo(20, 6);
    expect(result.votePool.protocolFee).toBe(0);
    expect(result.tagPool.protocolFee).toBe(0);
  });

  it("rolls the tags pool into the vote pool when there are no tag stakers", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [{ userId: "voter", stake: 10 }],
      tagPositions: [],
    });
    expect(result.votePool.distributable).toBeCloseTo(180, 6);
    expect(result.tagPool.shares).toHaveLength(0);
  });

  it("rolls the vote pool into the tags pool when there are no voters", () => {
    const result = distributeAppRevenue(200, {
      votePositions: [],
      tagPositions: [{ userId: "tagger", stake: 10 }],
    });
    expect(result.tagPool.distributable).toBeCloseTo(180, 6);
  });

  it("retains everything as undistributed when there is neither a voter nor a tagger", () => {
    const result = distributeAppRevenue(200, { votePositions: [], tagPositions: [] });
    expect(result.votePool.undistributed + result.tagPool.undistributed).toBeCloseTo(180, 6);
  });
});
