import { config } from "./config";

/**
 * Solana Explorer URL for a transaction signature, respecting the
 * configured cluster (explorer.solana.com defaults to mainnet-beta, so
 * that one cluster omits the query param entirely).
 */
export function explorerTxUrl(signature: string): string {
  const cluster = config.solana.cluster;
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
