import { describe, it, expect } from "vitest";
import { computeBuyQuote, spotPrice, soldFraction, type PoolState } from "./pool";

function freshPool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    totalSupply: 1_000_000,
    remainingSupply: 1_000_000,
    solRaised: 0,
    virtualSolReserves: 30,
    ...overrides,
  };
}

describe("computeBuyQuote", () => {
  it("matches an independently computed curve value for the first buy", () => {
    const pool = freshPool();
    const out = computeBuyQuote(pool, 1);

    const k = pool.virtualSolReserves * pool.totalSupply;
    const expectedReserveAfter = k / (pool.virtualSolReserves + 1);
    const expectedOut = pool.totalSupply - expectedReserveAfter;
    expect(out).toBeCloseTo(expectedOut, 6);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(pool.totalSupply);
  });

  it("yields a strictly smaller quote for the same solIn later in the curve", () => {
    const pool = freshPool();
    const first = computeBuyQuote(pool, 1);

    const second = computeBuyQuote(
      { ...pool, remainingSupply: pool.remainingSupply - first, solRaised: 1 },
      1,
    );

    expect(second).toBeLessThan(first);
  });

  it("approaches (without ever exceeding) the full remaining supply for a huge buy", () => {
    // A pure constant-product curve only asymptotically approaches full
    // depletion — unlike the Rust version's integer floor division, floats
    // never snap exactly to remainingSupply here, but must get arbitrarily
    // close and never cross it.
    const pool = freshPool({ totalSupply: 100, remainingSupply: 100, virtualSolReserves: 10 });
    const out = computeBuyQuote(pool, 100_000);
    expect(out).toBeGreaterThan(99.9);
    expect(out).toBeLessThanOrEqual(100);
  });

  it("throws when the pool is already sold out", () => {
    const pool = freshPool({ remainingSupply: 0 });
    expect(() => computeBuyQuote(pool, 1)).toThrow();
  });

  it("throws for a non-positive solIn", () => {
    expect(() => computeBuyQuote(freshPool(), 0)).toThrow();
    expect(() => computeBuyQuote(freshPool(), -1)).toThrow();
  });

  it("throws rather than returning a zero/negative quote for a dust trade", () => {
    // remainingSupply (5) sits far below the theoretical curve position at
    // this reserve (~5e8) — same inconsistent-state case pool_math.rs's
    // `rejects_rather_than_underflows_when_the_quote_would_be_zero_or_negative`
    // covers, exercising the clamp directly.
    const pool: PoolState = {
      totalSupply: 1_000_000_000,
      remainingSupply: 5,
      solRaised: 0,
      virtualSolReserves: 1,
    };
    expect(() => computeBuyQuote(pool, 1)).toThrow();
  });

  it("never returns more than remainingSupply", () => {
    const pool = freshPool({ remainingSupply: 42 });
    const out = computeBuyQuote(pool, 1_000_000);
    expect(out).toBeLessThanOrEqual(42);
  });
});

describe("spotPrice", () => {
  it("equals virtualSolReserves / totalSupply at pool creation", () => {
    const pool = freshPool();
    expect(spotPrice(pool)).toBeCloseTo(pool.virtualSolReserves / pool.totalSupply, 10);
  });

  it("increases as the pool depletes", () => {
    const pool = freshPool();
    const before = spotPrice(pool);
    const after = spotPrice({ ...pool, remainingSupply: pool.remainingSupply / 2, solRaised: 100 });
    expect(after).toBeGreaterThan(before);
  });

  it("is Infinity once sold out", () => {
    expect(spotPrice(freshPool({ remainingSupply: 0 }))).toBe(Infinity);
  });
});

describe("soldFraction", () => {
  it("is 0 for a fresh pool", () => {
    expect(soldFraction(freshPool())).toBe(0);
  });

  it("is 1 once fully sold out", () => {
    expect(soldFraction(freshPool({ remainingSupply: 0 }))).toBe(1);
  });

  it("is 0.5 at half depletion", () => {
    const pool = freshPool({ remainingSupply: 500_000 });
    expect(soldFraction(pool)).toBeCloseTo(0.5, 10);
  });
});
