import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { config } from "@/lib/config";

// The nebulous_world program's on-chain shape (PDA derivation, account
// fetches, instruction building) is now entirely the indexer's concern for
// the *live app* — see lib/indexerClient.ts and indexer/src/api.rs. This
// file keeps only pure, RPC-free helpers: unit conversion (every caller
// still needs it client-side) and the two PDA derivations still used by
// scripts/settleEpoch.ts, a manually-run treasury operation script that
// talks to RPC directly and independently of the app runtime (same
// category as scripts/launch-neb/) — mirrored here rather than duplicated
// so both stay byte-identical to indexer/src/api.rs's own derivation
// (cross-checked by a test there).

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function appPda(programId: PublicKey, appId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("app"), Buffer.from(appId)],
    programId,
  )[0];
}

export function toRawAmount(amount: number): BN {
  return new BN(Math.round(amount * 10 ** config.solana.voteTokenDecimals));
}

/** Inverse of `toRawAmount` — a raw on-chain u64 token amount to a human NEB number. */
export function fromRawAmount(raw: BN): number {
  return raw.toNumber() / 10 ** config.solana.voteTokenDecimals;
}

export interface ProgramTxResult {
  /** Confirmed transaction signature, or null when running in simulation mode. */
  txSig: string | null;
  simulated: boolean;
}
