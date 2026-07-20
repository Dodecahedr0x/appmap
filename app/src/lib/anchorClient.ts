import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { config } from "@/lib/config";

// The nebulous_world program's on-chain shape (PDA derivation, account
// fetches, instruction building) is now entirely the indexer's concern for
// the *live app* — see lib/indexerClient.ts and indexer/src/api.rs. This
// file keeps only pure, RPC-free helpers: unit conversion (every caller
// still needs it client-side) and the PDA derivations still used by
// manually-run scripts that talk to RPC directly and independently of the
// app runtime (scripts/settleEpoch.ts, scripts/createAppsOnchain.ts, same
// category as scripts/launch-neb/) — mirrored here rather than duplicated
// so they stay byte-identical to indexer/src/api.rs's own derivation
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

/** Global tag identity — seeds = [TAG_SEED, tag_id] (no `app`, see state/tag.rs). Also used by scripts/createAppsOnchain.ts. */
export function tagPda(programId: PublicKey, tagId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tag"), Buffer.from(tagId)],
    programId,
  )[0];
}

/** Per-(app, tag) stake accounting — seeds = [APP_TAG_STAKE_SEED, app, tag] (see state/app_tag_stake.rs). */
export function appTagStakePda(programId: PublicKey, app: PublicKey, tag: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("app_tag_stake"), app.toBuffer(), tag.toBuffer()],
    programId,
  )[0];
}

/** A user's vote position on one app — seeds = [VOTE_POSITION_SEED, app, user] (see state/vote_position.rs). */
export function votePositionPda(programId: PublicKey, app: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

/** A user's tag-stake position on one (app, tag) pair — seeds = [STAKE_POSITION_SEED, app_tag_stake, user] (see state/stake_position.rs). */
export function stakePositionPda(programId: PublicKey, appTagStake: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pos"), appTagStake.toBuffer(), user.toBuffer()],
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
