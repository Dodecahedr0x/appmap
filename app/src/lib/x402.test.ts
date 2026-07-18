import { describe, it, expect, vi, afterEach } from "vitest";
import {
  X402_ENDPOINTS,
  buildPaymentRequirements,
  paymentRequiredHeader,
  paymentResponseHeader,
  decodePaymentSignature,
  isX402Enabled,
  x402Network,
} from "./x402";

describe("x402Network", () => {
  it("defaults to the devnet genesis hash when no cluster is configured", () => {
    expect(x402Network()).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  });
});

describe("buildPaymentRequirements", () => {
  it("converts the endpoint's NEB price to a raw on-chain amount string", () => {
    const req = buildPaymentRequirements(X402_ENDPOINTS["platform-stats"], "https://example.com/api/data/platform-stats");
    // 0.01 NEB at the default 6 decimals -> 10_000 raw units.
    expect(req.accepts[0].amount).toBe("10000");
    expect(req.accepts[0].scheme).toBe("exact");
    expect(req.resource.url).toBe("https://example.com/api/data/platform-stats");
    expect(req.resource.description).toBe(X402_ENDPOINTS["platform-stats"].description);
  });
});

describe("paymentRequiredHeader / decodePaymentSignature round trip", () => {
  it("round-trips a PaymentRequirements object through base64", () => {
    const header = paymentRequiredHeader(X402_ENDPOINTS.tags, "https://example.com/api/data/tags");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    expect(decoded.accepts[0]).toMatchObject({ scheme: "exact" });
  });

  it("decodes a well-formed PAYMENT-SIGNATURE payload", () => {
    const payload = { payer: "somePubkey111", transaction: "base64tx==" };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    expect(decodePaymentSignature(header)).toEqual(payload);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(decodePaymentSignature("not-valid-base64-json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const header = Buffer.from(JSON.stringify({ payer: "x" })).toString("base64");
    expect(decodePaymentSignature(header)).toBeNull();
  });
});

describe("paymentResponseHeader", () => {
  it("encodes a settlement receipt as base64 JSON", () => {
    const header = paymentResponseHeader({ settled: true, transaction: "sig123", simulated: true });
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    expect(decoded).toEqual({ settled: true, transaction: "sig123", simulated: true });
  });
});

describe("isX402Enabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when no treasury address is configured (the default dev state)", () => {
    vi.stubEnv("NEXT_PUBLIC_TREASURY_ADDRESS", "");
    expect(isX402Enabled()).toBe(false);
  });

  it("stays false with a treasury address but no vote token mint configured", () => {
    // isSimulationMode() is keyed off config.solana.voteTokenMint, which is
    // frozen at module-load time from process.env — this repo's test env
    // never sets NEXT_PUBLIC_VOTE_TOKEN_MINT, so it's unset for every test
    // in this file regardless of stubEnv here (stubbing after config.ts's
    // module-level `const config = {...}` already ran has no effect on it).
    vi.stubEnv("NEXT_PUBLIC_TREASURY_ADDRESS", "someTreasuryPubkey");
    expect(isX402Enabled()).toBe(false);
  });
});
