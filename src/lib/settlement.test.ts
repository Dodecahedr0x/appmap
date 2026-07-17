import { describe, it, expect } from "vitest";
import { allocateByTrafficShare } from "./settlement";

describe("allocateByTrafficShare", () => {
  it("splits total earnings proportional to each app's revenue-eligible views", () => {
    const result = allocateByTrafficShare(100, [
      { appId: "a", eligibleViews: 75 },
      { appId: "b", eligibleViews: 25 },
    ]);
    expect(result.find((r) => r.appId === "a")!.gross).toBeCloseTo(75, 6);
    expect(result.find((r) => r.appId === "b")!.gross).toBeCloseTo(25, 6);
  });

  it("returns nothing allocated when there are no eligible views at all", () => {
    const result = allocateByTrafficShare(100, [{ appId: "a", eligibleViews: 0 }]);
    expect(result.find((r) => r.appId === "a")!.gross).toBe(0);
  });

  it("excludes apps with zero eligible views from receiving a share of others' traffic", () => {
    const result = allocateByTrafficShare(100, [
      { appId: "a", eligibleViews: 100 },
      { appId: "b", eligibleViews: 0 },
    ]);
    expect(result.find((r) => r.appId === "b")!.gross).toBe(0);
    expect(result.find((r) => r.appId === "a")!.gross).toBeCloseTo(100, 6);
  });
});
