// Buys NEB with USDC through the live NEB/USDC Meteora DLMM pool, then
// spreads it across every on-chain app (via `vote`) and (app, tag) pair (via
// `stake_tag`) with random weights — real on-chain staking activity for a
// fresh local dev environment to show, on top of the apps/tags
// scripts/createAppsOnchain.ts already registered. Signed by the same local
// dev keypair, same category of script (see AGENTS.md: there is no seed
// script for the database — this only ever sends genuine on-chain
// transactions, exactly like the "Create app" and vote/stake UI flows do).
//
// Unlike createAppsOnchain.ts this is NOT idempotent — every run adds more
// stake on top of whatever's already there, the same as a real user voting/
// staking again. That's intentional: repeated `dev:all` restarts should keep
// generating fresh activity, not skip once seeded.
//
// Every vote/stake_tag instruction is sent as its own transaction, and every
// transaction for this run is sent concurrently (Promise.allSettled over the
// full list — no batching/throttling), not one-by-one.
//
// Usage:
//   tsx --env-file=.env scripts/seedStakes.ts [--usdc=50] [--limit=N] [--dry-run]

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";
import {
  appPda,
  tagPda,
  appTagStakePda,
  configPda,
  votePositionPda,
  stakePositionPda,
  toRawAmount,
} from "../src/lib/anchorClient";
import { slugify } from "../src/lib/utils";
import { config } from "../src/lib/config";
import { deriveAppId, type AppEntry } from "./createAppsOnchain";
import { parseFlags } from "./lib/parseFlags";
import idl from "../../target/idl/nebulous_world.json";
import type { NebulousWorld } from "../../target/types/nebulous_world";

const DEPLOYER_KEYPAIR_PATH =
  process.env.DEPLOYER_KEYPAIR_PATH || `${homedir()}/.config/solana/id.json`;

// Same reasoning as scripts/launch-neb.config.json's "cluster": "mainnet-beta"
// — surfpool forks mainnet, so the DLMM SDK needs the mainnet program id even
// though we're talking to a local RPC.
const DLMM_CLUSTER = "mainnet-beta" as const;
const SWAP_SLIPPAGE_BPS = new BN(100); // 1%

// Leaves headroom below the actual NEB received before splitting it into
// random per-target amounts — rounding across dozens of targets should never
// be able to push the total over what was actually bought.
const ALLOCATION_BUFFER = 0.95;
const MIN_STAKE_NEB = 0.01;

interface Args {
  usdc: number;
  limit: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const f = parseFlags(argv);
  return {
    usdc: typeof f.usdc === "string" ? Number(f.usdc) : 50,
    limit: typeof f.limit === "string" ? Number(f.limit) : 25,
    dryRun: Boolean(f["dry-run"]),
  };
}

interface StakeTarget {
  kind: "vote" | "tag";
  appId: string;
  tagId?: string;
  label: string;
}

/** Every app (one `vote` target) and (app, tag) pair (one `stake_tag` target) from `entries`. */
function buildTargets(entries: AppEntry[]): StakeTarget[] {
  const targets: StakeTarget[] = [];
  for (const entry of entries) {
    const appId = deriveAppId(entry.url);
    const label = entry.name ?? entry.url;
    targets.push({ kind: "vote", appId, label });
    const tags = [...new Set((entry.tags ?? []).map((t) => slugify(t)).filter(Boolean))];
    for (const tagId of tags) {
      targets.push({ kind: "tag", appId, tagId, label: `${label} #${tagId}` });
    }
  }
  return targets;
}

/** Random positive weights (exponential, for a naturally uneven spread) normalized to sum to 1. */
function randomWeights(n: number): number[] {
  const raw = Array.from({ length: n }, () => -Math.log(1 - Math.random()));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Swaps `usdcAmount` USDC for NEB against the configured DLMM pool, signed by `payer`. */
async function buyNeb(
  connection: Connection,
  payer: Keypair,
  poolAddress: PublicKey,
  usdcAmount: number,
): Promise<{ sig: string; nebOut: number; nebMint: PublicKey }> {
  const pool = await DLMM.create(connection, poolAddress, { cluster: DLMM_CLUSTER });
  await pool.refetchStates();

  const usdcMint = pool.tokenY.publicKey;
  const nebMint = pool.tokenX.publicKey;
  const inAmount = new BN(Math.round(usdcAmount * 10 ** pool.tokenY.mint.decimals));

  const binArrays = await pool.getBinArrays();
  const quote = pool.swapQuote(inAmount, false, SWAP_SLIPPAGE_BPS, binArrays);

  const tx = await pool.swap({
    inToken: usdcMint,
    outToken: nebMint,
    inAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: pool.pubkey,
    user: payer.publicKey,
    binArraysPubkey: quote.binArraysPubkey,
  });
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  const nebOut = Number(new BN(quote.outAmount.toString())) / 10 ** pool.tokenX.mint.decimals;
  return { sig, nebOut, nebMint };
}

function voteIx(
  program: Program<NebulousWorld>,
  programId: PublicKey,
  payer: PublicKey,
  nebMint: PublicKey,
  appId: string,
  amount: number,
) {
  const app = appPda(programId, appId);
  const position = votePositionPda(programId, app, payer);
  const cfg = configPda(programId);
  const vault = getAssociatedTokenAddressSync(nebMint, cfg, true);
  const userTokenAccount = getAssociatedTokenAddressSync(nebMint, payer);
  return program.methods
    .vote(toRawAmount(amount))
    .accountsPartial({
      app,
      position,
      config: cfg,
      vault,
      userTokenAccount,
      user: payer,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

function stakeTagIx(
  program: Program<NebulousWorld>,
  programId: PublicKey,
  payer: PublicKey,
  nebMint: PublicKey,
  appId: string,
  tagId: string,
  amount: number,
) {
  const app = appPda(programId, appId);
  const tag = tagPda(programId, tagId);
  const appTagStake = appTagStakePda(programId, app, tag);
  const position = stakePositionPda(programId, appTagStake, payer);
  const cfg = configPda(programId);
  const vault = getAssociatedTokenAddressSync(nebMint, cfg, true);
  const userTokenAccount = getAssociatedTokenAddressSync(nebMint, payer);
  return program.methods
    .stakeTag(toRawAmount(amount))
    .accountsPartial({
      app,
      appTagStake,
      position,
      config: cfg,
      vault,
      userTokenAccount,
      user: payer,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

type SendResult =
  | { status: "sent"; target: StakeTarget; amount: number; sig: string }
  | { status: "failed"; target: StakeTarget; amount: number; error: string };

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!config.solana.programId) throw new Error("NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID must be set");
  if (!config.solana.voteTokenMint) throw new Error("NEXT_PUBLIC_VOTE_TOKEN_MINT must be set");
  const poolAddr = process.env.NEXT_PUBLIC_NEB_DLMM_POOL;
  if (!poolAddr) throw new Error("NEXT_PUBLIC_NEB_DLMM_POOL must be set");

  const entries = (
    JSON.parse(readFileSync("scripts/appData/apps.json", "utf-8")) as AppEntry[]
  ).slice(0, args.limit);
  const targets = buildTargets(entries);
  console.log(
    `🎯 ${targets.length} target(s) (${entries.length} app(s), ${targets.length - entries.length} tag pair(s))`,
  );

  if (args.dryRun) {
    console.log(`🧪 Dry run — would buy ${args.usdc} USDC of NEB and split it across the targets above`);
    return;
  }

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(DEPLOYER_KEYPAIR_PATH, "utf-8"))),
  );
  const connection = new Connection(config.solana.rpc, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program = new Program<NebulousWorld>(idl as NebulousWorld, provider);
  const programId = new PublicKey(config.solana.programId);

  console.log(`🔑 Paying/signing with ${payer.publicKey.toBase58()}`);
  console.log(`💵 Buying NEB with ${args.usdc} USDC`);
  const { sig: buySig, nebOut, nebMint } = await buyNeb(
    connection,
    payer,
    new PublicKey(poolAddr),
    args.usdc,
  );
  console.log(`  ✓ bought ${nebOut.toFixed(4)} NEB (tx ${buySig.slice(0, 12)}…)`);

  const totalToAllocate = nebOut * ALLOCATION_BUFFER;
  const weights = randomWeights(targets.length);
  const amounts = weights.map((w) => Math.max(totalToAllocate * w, MIN_STAKE_NEB));

  console.log(`📤 Sending ${targets.length} vote/stake transaction(s) in parallel…`);
  const { blockhash } = await connection.getLatestBlockhash();

  const results = await Promise.allSettled(
    targets.map(async (target, i): Promise<SendResult> => {
      const amount = amounts[i]!;
      try {
        const ix =
          target.kind === "vote"
            ? await voteIx(program, programId, payer.publicKey, nebMint, target.appId, amount)
            : await stakeTagIx(
                program,
                programId,
                payer.publicKey,
                nebMint,
                target.appId,
                target.tagId!,
                amount,
              );
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
        return { status: "sent", target, amount, sig };
      } catch (err) {
        return { status: "failed", target, amount, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  let sent = 0;
  let failed = 0;
  let totalStaked = 0;
  for (const result of results) {
    // Every promise resolves to a `SendResult` — the try/catch above already
    // turns failures into `{ status: "failed" }` — so `allSettled` itself
    // never actually rejects any of these.
    const r = result.status === "fulfilled" ? result.value : null;
    if (!r) continue;
    if (r.status === "sent") {
      sent++;
      totalStaked += r.amount;
      console.log(`  ✓ ${r.target.kind} ${r.target.label}: ${r.amount.toFixed(4)} NEB (tx ${r.sig.slice(0, 12)}…)`);
    } else {
      failed++;
      console.error(`  ✗ ${r.target.kind} ${r.target.label}: ${r.error}`);
    }
  }

  console.log(
    `${sent} sent (${totalStaked.toFixed(2)} NEB staked), ${failed} failed, out of ${targets.length}.`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
