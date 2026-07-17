import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchAdsenseEarnings } from "./adsense";

describe("fetchAdsenseEarnings", () => {
  beforeEach(() => vi.stubEnv("ADSENSE_ACCOUNT_ID", "pub-123"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the total earnings for the period from the AdSense API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ totals: { cells: [{}, {}, { value: "142.37" }] } }),
      }),
    );
    const earnings = await fetchAdsenseEarnings(
      { start: new Date("2026-07-01"), end: new Date("2026-07-08") },
      "fake-access-token",
    );
    expect(earnings).toBeCloseTo(142.37, 2);
  });

  it("throws when the AdSense API responds with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }),
    );
    await expect(
      fetchAdsenseEarnings({ start: new Date("2026-07-01"), end: new Date("2026-07-08") }, "bad-token"),
    ).rejects.toThrow();
  });

  it("throws when ADSENSE_ACCOUNT_ID isn't configured", async () => {
    vi.stubEnv("ADSENSE_ACCOUNT_ID", "");
    await expect(
      fetchAdsenseEarnings({ start: new Date("2026-07-01"), end: new Date("2026-07-08") }, "token"),
    ).rejects.toThrow();
  });
});
