// Live NEB/USDC Meteora DLMM pool state — reads directly from chain, no DB
// cache. Unlike the old native bonding-curve pool (which our own program
// owned and updated), the DLMM pool is a public AMM anyone can trade
// against, so it — not our database — is the only source of truth for
// price/liquidity. See scripts/launch-neb/ for how the pool gets created.

import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import { config } from "./config";

export interface NebPoolStatus {
  poolAddress: string;
  /** USDC per NEB, at the pool's current active bin. */
  price: number;
  /** NEB currently held by the pool, UI units. */
  nebReserve: number;
  /** USDC currently held by the pool, UI units. */
  usdcReserve: number;
}

export function getNebDlmmPoolAddress(): PublicKey | null {
  return config.solana.nebDlmmPool ? new PublicKey(config.solana.nebDlmmPool) : null;
}

function dlmmCluster() {
  return config.solana.cluster === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

/** Loads the live DLMM pool. Returns null when no pool is configured (mirrors isSimulationMode()'s "no mint configured" pattern). */
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
  };
}
