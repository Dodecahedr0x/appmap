import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns false when no token is provided", async () => {
    expect(await verifyTurnstileToken(null)).toBe(false);
  });

  it("returns false when TURNSTILE_SECRET_KEY isn't configured, even with a token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    expect(await verifyTurnstileToken("valid-token")).toBe(false);
  });

  it("returns true when Cloudflare reports success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    expect(await verifyTurnstileToken("valid-token")).toBe(true);
  });

  it("returns false when Cloudflare reports failure", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
    expect(await verifyTurnstileToken("bad-token")).toBe(false);
  });
});
