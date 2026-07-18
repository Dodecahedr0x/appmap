import { describe, it, expect } from "vitest";
import { linearDecayFeeBps, estimateUnstakeFee, UNSTAKE_FEE_START_BPS, UNSTAKE_FEE_DECAY_SECONDS } from "./unstakeFee";

describe("linearDecayFeeBps", () => {
  it("is the full start fee at zero elapsed", () => {
    expect(linearDecayFeeBps(0)).toBe(UNSTAKE_FEE_START_BPS);
  });

  it("clamps negative elapsed to the start fee", () => {
    expect(linearDecayFeeBps(-1)).toBe(UNSTAKE_FEE_START_BPS);
  });

  it("is exactly half at the midpoint", () => {
    expect(linearDecayFeeBps(UNSTAKE_FEE_DECAY_SECONDS / 2)).toBe(UNSTAKE_FEE_START_BPS / 2);
  });

  it("is zero at exactly the decay window", () => {
    expect(linearDecayFeeBps(UNSTAKE_FEE_DECAY_SECONDS)).toBe(0);
  });

  it("is zero past the decay window", () => {
    expect(linearDecayFeeBps(UNSTAKE_FEE_DECAY_SECONDS * 2)).toBe(0);
  });
});

describe("estimateUnstakeFee", () => {
  it("charges 1% at elapsed=0", () => {
    const now = 1_000_000;
    const result = estimateUnstakeFee(100, now, now);
    expect(result.feeBps).toBe(100);
    expect(result.fee).toBe(1);
    expect(result.net).toBe(99);
  });

  it("charges nothing a week after staking", () => {
    const stakedAt = 1_000_000;
    const now = stakedAt + UNSTAKE_FEE_DECAY_SECONDS;
    const result = estimateUnstakeFee(100, stakedAt, now);
    expect(result.feeBps).toBe(0);
    expect(result.fee).toBe(0);
    expect(result.net).toBe(100);
  });

  it("defaults `now` to the wall clock when omitted", () => {
    const nowSecs = Date.now() / 1000;
    const result = estimateUnstakeFee(100, nowSecs);
    expect(result.feeBps).toBe(100);
  });
});
