import { describe, it, expect } from "vitest";
import { interleaveAds } from "./adPlacement";

function apps(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `app-${i}` }));
}

describe("interleaveAds", () => {
  it("inserts nothing when there are fewer apps than the interval", () => {
    const result = interleaveAds(apps(3), 6);
    expect(result.every((e) => e.kind === "app")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("inserts one ad slot right after every Nth app", () => {
    const result = interleaveAds(apps(7), 3);
    expect(result.map((e) => e.kind)).toEqual([
      "app", "app", "app", "ad", "app", "app", "app", "ad", "app",
    ]);
  });

  it("attributes each ad slot to the app it immediately follows", () => {
    const result = interleaveAds(apps(3), 3);
    const ad = result.find((e) => e.kind === "ad");
    expect(ad).toMatchObject({ kind: "ad", appId: "app-2" });
  });

  it("does not append a trailing ad slot when the last app isn't a multiple of the interval", () => {
    const result = interleaveAds(apps(4), 3);
    expect(result.at(-1)).toMatchObject({ kind: "app", app: { id: "app-3" } });
  });

  it("gives every ad slot a unique key even across multiple insertions", () => {
    const result = interleaveAds(apps(9), 3);
    const adKeys = result.filter((e) => e.kind === "ad").map((e) => (e as { key: string }).key);
    expect(new Set(adKeys).size).toBe(adKeys.length);
    expect(adKeys).toHaveLength(3);
  });

  it("falls back to no insertions for a non-positive interval instead of looping forever", () => {
    const result = interleaveAds(apps(5), 0);
    expect(result).toHaveLength(5);
    expect(result.every((e) => e.kind === "app")).toBe(true);
  });
});
