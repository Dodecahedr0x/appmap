import { describe, it, expect } from "vitest";
import { BN } from "@anchor-lang/core";
import { settlePendingRaw, REWARD_PRECISION } from "./rewards";

describe("settlePendingRaw", () => {
  it("mirrors the Rust realistic case: 1000 staked, acc = 0.05/share, debt = 10 => pending 40", () => {
    const amount = new BN(1_000);
    const acc = REWARD_PRECISION.divn(20); // 0.05 * PRECISION
    const rewardDebt = new BN(10);

    expect(settlePendingRaw(amount, rewardDebt, acc).toString()).toBe("40");
  });

  it("is zero when the position has no stake", () => {
    const pending = settlePendingRaw(new BN(0), new BN(0), REWARD_PRECISION.muln(5));
    expect(pending.toString()).toBe("0");
  });

  it("is zero when the accumulator has never been funded", () => {
    const pending = settlePendingRaw(new BN(1_000), new BN(0), new BN(0));
    expect(pending.toString()).toBe("0");
  });

  it("saturates to zero rather than going negative when reward_debt exceeds accrued", () => {
    // amount * acc / PRECISION rounds down to 0, but reward_debt is 100 (stale).
    const pending = settlePendingRaw(new BN(1), new BN(100), new BN(1));
    expect(pending.toString()).toBe("0");
  });

  it("round-trips with a funded pool: staking the entire pool yields exactly the funded amount", () => {
    // Mirrors bump_accumulator + settle_pending's round-trip property test in
    // reward_math.rs: funding 6000 across a 2000-total-stake pool, then
    // settling a position holding the entire stake, returns exactly 6000.
    const totalStake = new BN(2_000);
    const fundedAmount = new BN(6_000);
    const acc = fundedAmount.mul(REWARD_PRECISION).div(totalStake);
    const pending = settlePendingRaw(totalStake, new BN(0), acc);
    expect(pending.toString()).toBe(fundedAmount.toString());
  });
});
