import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { config } from "@/lib/config";
import idl from "../../../target/idl/nebulous_world.json";
import type { NebulousWorld } from "../../../target/types/nebulous_world";

export function getNebulousWorldProgram(
  connection: Connection,
  wallet: WalletContextState,
): Program<NebulousWorld> {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
    throw new Error("Wallet must be connected and support transaction signing");
  }
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    },
    { commitment: "confirmed" },
  );
  return new Program(idl as NebulousWorld, provider);
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function appPda(programId: PublicKey, appId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("app"), Buffer.from(appId)],
    programId,
  )[0];
}

export function votePositionPda(
  programId: PublicKey,
  app: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote_pos"), app.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

export function appTagPda(programId: PublicKey, app: PublicKey, tagId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tag"), app.toBuffer(), Buffer.from(tagId)],
    programId,
  )[0];
}

export function stakePositionPda(
  programId: PublicKey,
  appTag: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pos"), appTag.toBuffer(), user.toBuffer()],
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

/**
 * A connection-only Program instance for read-only account fetches
 * (`program.account.x.fetch(...)`), which never sign transactions and so
 * don't need a connected wallet — unlike `getNebulousWorldProgram`, this
 * works for anyone viewing the page, wallet connected or not.
 */
export function getReadOnlyNebulousWorldProgram(connection: Connection): Program<NebulousWorld> {
  const readOnlyWallet = {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("Read-only client cannot sign transactions");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only client cannot sign transactions");
    },
  };
  const provider = new AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" });
  return new Program(idl as NebulousWorld, provider);
}

/** Lamports per SOL, for converting UI-facing SOL amounts to buy_neb's raw u64 lamport argument. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function toRawLamports(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

export function nebPoolPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("neb_pool")], programId)[0];
}

export function nebPoolVaultPda(programId: PublicKey, pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("neb_pool_vault"), pool.toBuffer()],
    programId,
  )[0];
}

export interface ProgramTxResult {
  /** Confirmed transaction signature, or null when running in simulation mode. */
  txSig: string | null;
  simulated: boolean;
}
