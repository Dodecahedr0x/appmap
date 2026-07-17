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
