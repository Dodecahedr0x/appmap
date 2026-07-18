"use client";

// Client-side helpers for the app/src/app/api/{accounts,balances,tx}/**
// proxy routes — every one of them just forwards to the indexer (see
// lib/indexerClient.ts, which only that server-side proxy layer imports).
// The browser never talks to Solana RPC directly, and never did anything
// but sign here: `signAndSubmit` deserializes an unsigned transaction the
// indexer built, has the connected wallet sign it locally (the private key
// never leaves the browser/extension), and posts the signed bytes back to
// /api/tx/submit for the indexer to relay to the network.

import { Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { isSimulationMode } from "@/lib/config";
import type { ProgramTxResult } from "@/lib/anchorClient";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || `GET ${path} failed`);
  return json.data as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || `POST ${path} failed`);
  return json.data as T;
}

/**
 * Polls `apiGet(path)` until it resolves (rather than 404ing) or `attempts`
 * is exhausted — used right after an on-chain transaction confirms, while
 * waiting for the indexer to catch up and create the corresponding Postgres
 * row (there is no synchronous DB write in that path — see AGENTS.md).
 * Returns `null` on timeout rather than throwing: the on-chain transaction
 * already succeeded either way, so the caller just degrades the UI (e.g.
 * "still indexing, refresh shortly") instead of treating it as an error.
 */
export async function pollUntilIndexed<T>(
  path: string,
  { attempts = 10, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {},
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await apiGet<T>(path);
    } catch {
      // Not indexed yet — wait and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * Builds (via the indexer, `POST path`), signs, and submits a program
 * transaction — the shared shape behind every vote/stake/claim action. In
 * simulation mode (no vote mint configured) this short-circuits without
 * touching the chain, same as the off-chain fallback it replaces.
 */
export async function runProgramTx(
  wallet: WalletContextState,
  path: string,
  body: Record<string, unknown>,
): Promise<ProgramTxResult> {
  if (isSimulationMode()) return { txSig: null, simulated: true };
  if (!wallet.publicKey) throw new Error("Connect your wallet first");

  const { transaction } = await apiPost<{ transaction: string }>(path, {
    ...body,
    user: wallet.publicKey.toBase58(),
  });
  const txSig = await signAndSubmit(wallet, transaction);
  return { txSig, simulated: false };
}

/** Signs an indexer-built unsigned transaction and submits it, returning the confirmed signature. */
export async function signAndSubmit(
  wallet: WalletContextState,
  unsignedTransactionBase64: string,
): Promise<string> {
  if (!wallet.signTransaction) throw new Error("Wallet can't sign transactions");
  const tx = Transaction.from(Buffer.from(unsignedTransactionBase64, "base64"));
  const signed = await wallet.signTransaction(tx);
  const signedBase64 = Buffer.from(
    signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
  const { signature } = await apiPost<{ signature: string }>("/api/tx/submit", {
    signedTransaction: signedBase64,
  });
  return signature;
}
