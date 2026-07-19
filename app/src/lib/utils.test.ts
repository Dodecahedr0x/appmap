import { describe, it, expect } from "vitest";
import { formatDelta } from "./utils";

describe("formatDelta", () => {
  it("formats a positive change with a leading plus sign", () => {
    expect(formatDelta(12.4, 7)).toBe("+12%/7d");
  });

  it("formats a negative change with a minus sign, no double sign", () => {
    expect(formatDelta(-8.2, 7)).toBe("-8%/7d");
  });

  it("rounds to the nearest whole percent", () => {
    expect(formatDelta(12.6, 7)).toBe("+13%/7d");
    expect(formatDelta(12.4, 7)).toBe("+12%/7d");
  });

  it("shows a genuine zero change rather than hiding it", () => {
    expect(formatDelta(0, 7)).toBe("+0%/7d");
  });

  it("uses the given interval in the label", () => {
    expect(formatDelta(5, 30)).toBe("+5%/30d");
  });

  it("returns null (no baseline to compare against) instead of a fake 0%", () => {
    expect(formatDelta(null, 7)).toBeNull();
  });
});
