// Mirrors app/src/lib/dlmm.ts exactly (this sidecar exists specifically so
// that logic can keep living here, server-side, instead of in the Next.js
// app — see README.md).

import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";

export interface NebPoolStatus {
  poolAddress: string;
  price: number;
  nebReserve: number;
  usdcReserve: number;
  nebMint: string;
  usdcMint: string;
}

function dlmmCluster(): "mainnet-beta" | "devnet" {
  return process.env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

export function getNebDlmmPoolAddress(): PublicKey | null {
  const addr = process.env.NEB_DLMM_POOL;
  return addr ? new PublicKey(addr) : null;
}

export async function loadNebPool(connection: Connection) {
  const poolAddress = getNebDlmmPoolAddress();
  if (!poolAddress) return null;
  return DLMM.create(connection, poolAddress, { cluster: dlmmCluster() });
}

export async function fetchNebPoolStatus(connection: Connection): Promise<NebPoolStatus | null> {
  const pool = await loadNebPool(connection);
  if (!pool) return null;
  const activeBin = await pool.getActiveBin();

  return {
    poolAddress: pool.pubkey.toBase58(),
    price: Number(activeBin.pricePerToken),
    nebReserve: Number(pool.tokenX.amount) / 10 ** pool.tokenX.mint.decimals,
    usdcReserve: Number(pool.tokenY.amount) / 10 ** pool.tokenY.mint.decimals,
    nebMint: pool.tokenX.publicKey.toBase58(),
    usdcMint: pool.tokenY.publicKey.toBase58(),
  };
}
