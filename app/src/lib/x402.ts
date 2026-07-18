import { NextRequest, NextResponse } from "next/server";
import { config, isSimulationMode } from "./config";
import { toRawAmount } from "./anchorClient";
import { settleX402Payment } from "./indexerClient";

// x402 (https://www.x402.org) — the open, HTTP-native micropayment standard
// this app uses to price its /api/data/* endpoints (see app/src/app/api/data/**).
// This file is the ONE place prices are defined: both those routes and the
// About page's pricing table import X402_ENDPOINTS directly, so the two can
// never drift out of sync with each other.
//
// Prices are in NEB — the same token every other on-chain feature in this
// app (votes, tag stakes) already uses; there's no reason to introduce a
// second currency just for this. Settlement is a direct SPL token transfer
// to NEXT_PUBLIC_TREASURY_ADDRESS (declared in .env.example but unused
// anywhere else in this codebase until now — this is its first real
// purpose), verified and submitted by the indexer's own
// POST /x402/settle (see indexer/src/handlers/x402.rs), not a third-party
// facilitator: no public facilitator knows about this app's token, let
// alone a local Surfpool/devnet cluster in dev.
//
// Deliberately NOT mirrored on the Rust side as its own price table —
// /x402/settle just verifies a submitted transfer against whatever
// amount/mint/destination the caller (this file, via the API routes) says
// to expect. Pricing knowledge lives in exactly one language.

export interface X402Endpoint {
  key: string;
  path: string;
  priceNeb: number;
  description: string;
}

export const X402_ENDPOINTS: Record<string, X402Endpoint> = {
  "platform-stats": {
    key: "platform-stats",
    path: "/api/data/platform-stats",
    priceNeb: 0.01,
    description:
      "Platform-wide totals: approved apps, distinct tags, total vote weight, total tag stake, and page views.",
  },
  "platform-history": {
    key: "platform-history",
    path: "/api/data/platform-history",
    priceNeb: 0.05,
    description: "Daily time series of the same on-chain totals, since the platform's first snapshot.",
  },
  tags: {
    key: "tags",
    path: "/api/data/tags",
    priceNeb: 0.05,
    description: "Every tag in use, with its total stake and how many approved apps carry it.",
  },
  traffic: {
    key: "traffic",
    path: "/api/data/traffic",
    priceNeb: 0.5,
    description:
      "Revenue-eligible page-view counts per app over a given date range — not available anywhere else, priced/gated for the first time here.",
  },
};

export const X402_SCHEME = "exact";

// CAIP-2 network identifiers x402 uses to name a chain. Solana clusters
// don't have short EVM-style chain ids — the identifier is the cluster's
// own genesis hash (see https://solana.com/docs/rpc/http/getgenesishash).
const SOLANA_GENESIS_HASH: Record<string, string> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
};

export function x402Network(): string {
  return `solana:${SOLANA_GENESIS_HASH[config.solana.cluster] ?? SOLANA_GENESIS_HASH.devnet}`;
}

/**
 * Same degrade-gracefully switch every other on-chain feature in this app
 * already uses (see isSimulationMode) — keyed off whether a real mint AND a
 * treasury address are both configured. With either unset, /api/data/*
 * serves data for free with a `simulated: true` receipt instead of 402ing,
 * so the feature is fully exercisable without a funded wallet.
 */
export function isX402Enabled(): boolean {
  return !isSimulationMode() && Boolean(process.env.NEXT_PUBLIC_TREASURY_ADDRESS);
}

export interface PaymentRequirements {
  accepts: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
  }[];
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
}

const MAX_TIMEOUT_SECONDS = 60;

/** Builds the JSON body of the PAYMENT-REQUIRED header for a 402 response. */
export function buildPaymentRequirements(endpoint: X402Endpoint, resourceUrl: string): PaymentRequirements {
  return {
    accepts: [
      {
        scheme: X402_SCHEME,
        network: x402Network(),
        amount: toRawAmount(endpoint.priceNeb).toString(),
        asset: config.solana.voteTokenMint,
        payTo: process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? "",
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      },
    ],
    resource: {
      url: resourceUrl,
      description: endpoint.description,
      mimeType: "application/json",
    },
  };
}

/** The `PAYMENT-REQUIRED` header value: base64 of buildPaymentRequirements' JSON. */
export function paymentRequiredHeader(endpoint: X402Endpoint, resourceUrl: string): string {
  return Buffer.from(JSON.stringify(buildPaymentRequirements(endpoint, resourceUrl))).toString("base64");
}

export interface PaymentPayload {
  payer: string;
  /** Base64-encoded, fully-signed, serialized Solana transaction — see this file's module doc on why Solana's x402 scheme is "hand over a ready-to-submit transaction" rather than EVM's signature-authorization scheme. */
  transaction: string;
}

/**
 * Decodes a client's `PAYMENT-SIGNATURE` header. Returns `null` for
 * anything malformed rather than throwing — an unparseable payment is
 * exactly as "not paid" as a missing header, from the caller's
 * perspective, so both should fall through to the same 402 response.
 */
export function decodePaymentSignature(header: string): PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    if (typeof parsed?.payer === "string" && typeof parsed?.transaction === "string") {
      return { payer: parsed.payer, transaction: parsed.transaction };
    }
    return null;
  } catch {
    return null;
  }
}

export interface SettlementReceipt {
  settled: boolean;
  transaction: string;
  simulated?: boolean;
}

/** The `PAYMENT-RESPONSE` header value: base64 of a SettlementReceipt. */
export function paymentResponseHeader(receipt: SettlementReceipt): string {
  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

function paymentRequiredResponse(endpoint: X402Endpoint, resourceUrl: string, error?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: error ?? "Payment required", accepts: buildPaymentRequirements(endpoint, resourceUrl).accepts },
    { status: 402, headers: { "PAYMENT-REQUIRED": paymentRequiredHeader(endpoint, resourceUrl) } },
  );
}

export type X402Gate = { ok: true; receipt: SettlementReceipt } | { ok: false; response: NextResponse };

/**
 * The gate every `/api/data/*` route calls first — same "throw/return early
 * if not allowed" shape as api.ts's `requireUser()`, adapted to return
 * rather than throw since a 402 needs a custom header `fail()` doesn't
 * support, and a route handler is the simplest place to attach one.
 *
 * In simulation mode (see isX402Enabled) this always succeeds for free,
 * exactly like votes/stakes already degrade when no real mint is
 * configured — the endpoint is fully exercisable without a funded wallet.
 */
export async function requireX402Payment(req: NextRequest, endpointKey: keyof typeof X402_ENDPOINTS): Promise<X402Gate> {
  const endpoint = X402_ENDPOINTS[endpointKey];
  const resourceUrl = req.nextUrl.toString();

  if (!isX402Enabled()) {
    return { ok: true, receipt: { settled: true, transaction: "", simulated: true } };
  }

  const header = req.headers.get("PAYMENT-SIGNATURE");
  if (!header) {
    return { ok: false, response: paymentRequiredResponse(endpoint, resourceUrl) };
  }
  const payload = decodePaymentSignature(header);
  if (!payload) {
    return { ok: false, response: paymentRequiredResponse(endpoint, resourceUrl, "Malformed PAYMENT-SIGNATURE header") };
  }

  try {
    const result = await settleX402Payment({
      signedTransaction: payload.transaction,
      expectedAmountRaw: toRawAmount(endpoint.priceNeb).toString(),
      expectedMint: config.solana.voteTokenMint,
      expectedPayTo: process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? "",
    });
    return { ok: true, receipt: { settled: result.settled, transaction: result.transaction } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment settlement failed";
    return { ok: false, response: paymentRequiredResponse(endpoint, resourceUrl, message) };
  }
}
