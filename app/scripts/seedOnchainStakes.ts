// Real, on-chain dev-environment seeding: unlike prisma/seed.ts (which
// writes plain random Vote/Stake numbers straight into Postgres — no chain
// interaction at all, see the note at the top of that file), this script
// actually buys NEB out of the live NEB/USDC DLMM pool and stakes it
// against every app/tag prisma/seed.ts created, via real `init_app` /
// `suggest_tag` / `vote` / `stake_tag` instructions against the deployed
// nebulous_world program. Without this, the pool holds the entire NEB
// supply forever and the program has zero real on-chain activity, no
// matter how populated the app looks in the UI.
//
// Requires the full local dev stack already up (surfpool, the deployed
// program, the NEB/USDC DLMM pool, Postgres seeded with apps/tags — i.e.
// scripts/setup-dev.sh's flow, or `npm run dev:all`). Safe to re-run: apps/
// tags that already have on-chain accounts are detected and skipped past
// (see ensureOnChain below), and each run just adds another round of
// voting/staking with a freshly generated wallet.
//
// Usage:
//   tsx scripts/seedOnchainStakes.ts [--usdc=400] [--concurrency=6] [--sol=2]

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@anchor-lang/core";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import DLMM from "@meteora-ag/dlmm";
import { prisma } from "../src/lib/prisma";
import { refreshApp, refreshAppTag } from "../src/lib/engine";
import { config } from "../src/lib/config";
import { configPda, appPda } from "../src/lib/anchorClient";
import idl from "../../target/idl/nebulous_world.json";
import type { NebulousWorld } from "../../target/types/nebulous_world";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// Real mainnet USDC — surfpool forks mainnet, so this is the same mint
// setup-dev.sh airdrops to the dev keypair (see USDC_MINT there).
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SLIPPAGE_BPS = new BN(100); // 1%, matches indexer/dlmm-bridge/src/swap.ts
// Owns the BPF Upgradeable Loader's `ProgramData` PDA (seeds = [programId]),
// needed to resolve `initialize`'s `program_data` account below.
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
// Matches setup-dev.sh's DEV_KEYPAIR — the wallet that deployed the program,
// i.e. its upgrade authority, which is the only signer `initialize` accepts.
const DEV_KEYPAIR_PATH = `${homedir()}/.config/solana/id.json`;

function parseArgs(argv: string[]) {
  const get = (name: string, fallback: number) => {
    const arg = argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.slice(name.length + 3)) : fallback;
  };
  return {
    usdc: get("usdc", 400), // how much USDC to swap for NEB
    concurrency: get("concurrency", 6), // apps processed at once
    sol: get("sol", 2), // SOL airdropped to the seeding wallet
  };
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Deterministic pseudo-random weights so a given seed run's split across
// apps/tags is reproducible — same generator as prisma/seed.ts, separate
// instance so re-running this script doesn't depend on how many random
// numbers that script drew.
let rngState = 4242;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

/**
 * Anchor's `init` accounts (app_tag_stake, and `app` itself) reject a
 * second `init_app`/`suggest_tag` for the same id with a SystemProgram
 * "already in use" error — expected on a re-run against a stack that
 * wasn't freshly reset. Treat that specific failure as "already seeded,
 * move on"; anything else is a real failure and should still surface.
 */
async function ensureOnChain(label: string, send: () => Promise<string>): Promise<void> {
  try {
    const sig = await send();
    console.log(`    + ${label} (${sig.slice(0, 12)}…)`);
  } catch (err) {
    // The "already in use" text can land in the top-level error message or
    // only inside the simulation logs, depending on how @solana/web3.js
    // wraps the RPC response — check both rather than guessing which.
    const logs: unknown = err && typeof err === "object" ? (err as { logs?: unknown }).logs : undefined;
    const haystack = [
      err instanceof Error ? err.message : String(err),
      Array.isArray(logs) ? logs.join("\n") : "",
    ].join("\n");
    if (/already in use/i.test(haystack)) {
      console.log(`    · ${label} already exists on-chain, skipping`);
      return;
    }
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!config.solana.voteTokenMint || !config.solana.programId) {
    throw new Error(
      "NEXT_PUBLIC_VOTE_TOKEN_MINT / NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID must be set — " +
        "run scripts/launch-neb (or setup-dev.sh, which runs it) first.",
    );
  }
  const poolAddress = process.env.NEXT_PUBLIC_NEB_DLMM_POOL;
  if (!poolAddress) {
    throw new Error("NEXT_PUBLIC_NEB_DLMM_POOL must be set — NEB hasn't been launched yet.");
  }

  // Default confirmTransactionInitialTimeout is 30s, tight enough that a
  // burst of concurrent votes/stakes all landing on the same shared
  // vault/config accounts (see the design note on Config) can occasionally
  // miss it on a single local validator even though the transaction lands
  // fine — give it more headroom rather than tune down the concurrency
  // this script is explicitly meant to exercise.
  const connection = new Connection(config.solana.rpc, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  });
  const mint = new PublicKey(config.solana.voteTokenMint);
  const decimals = config.solana.voteTokenDecimals;
  const programId = new PublicKey(config.solana.programId);
  const cfgPda = configPda(programId);
  const vault = getAssociatedTokenAddressSync(mint, cfgPda, true);

  // `Config` (the one global singleton every vote/stake instruction reads)
  // only ever gets created by a single, one-time `initialize` call, signed
  // by the program's upgrade authority — nothing in setup-dev.sh's deploy
  // flow does this, so on a freshly deployed program it doesn't exist yet
  // and every instruction below would fail with AccountNotInitialized.
  const devKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(DEV_KEYPAIR_PATH, "utf-8"))),
  );
  const devProvider = new AnchorProvider(connection, new Wallet(devKeypair), { commitment: "confirmed" });
  const devProgram = new Program<NebulousWorld>(idl as NebulousWorld, devProvider);
  const configAccountInfo = await connection.getAccountInfo(cfgPda);
  if (!configAccountInfo) {
    console.log(`⚙️  Config isn't initialized yet — calling initialize() as the upgrade authority`);
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    const sig = await devProgram.methods
      .initialize(250) // 2.5% protocol fee — arbitrary for local dev, matches the Rust test default
      .accountsPartial({
        config: cfgPda,
        vault,
        authority: devKeypair.publicKey,
        voteMint: mint,
        program: programId,
        programData: programDataPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   initialized (tx ${sig.slice(0, 12)}…)`);
  } else {
    console.log(`⚙️  Config already initialized, skipping`);
  }

  console.log(`🔑 Generating a fresh seeding wallet`);
  const wallet = Keypair.generate();
  console.log(`   ${wallet.publicKey.toBase58()}`);

  console.log(`💧 Airdropping ${args.sol} SOL`);
  const airdropSig = await connection.requestAirdrop(wallet.publicKey, args.sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig, "confirmed");

  console.log(`💵 Airdropping ${args.usdc} USDC (surfpool-only RPC method)`);
  const usdcRes = await fetch(config.solana.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setTokenAccount",
      params: [
        wallet.publicKey.toBase58(),
        USDC_MINT.toBase58(),
        { amount: Math.round(args.usdc * 10 ** 6) },
        TOKEN_PROGRAM_ID.toBase58(),
      ],
    }),
  }).then((r) => r.json());
  if (usdcRes.error) {
    throw new Error(
      `USDC airdrop failed: ${JSON.stringify(usdcRes.error)} — this method only exists on a surfpool ` +
        `Surfnet, not a real cluster.`,
    );
  }

  console.log(`🔄 Buying NEB with ${args.usdc} USDC via the DLMM pool`);
  // Same shape as indexer/dlmm-bridge/src/swap.ts's buildBuyNebTx, except
  // signed and sent immediately with our own keypair instead of returned
  // as unsigned bytes for a browser wallet to sign.
  const pool = await DLMM.create(connection, new PublicKey(poolAddress), {
    cluster: "mainnet-beta", // surfpool forks mainnet — same DLMM program id as launch-neb.config.json
  });
  await pool.refetchStates();
  const usdcMint = pool.tokenY.publicKey;
  const nebMint = pool.tokenX.publicKey;
  const inAmount = new BN(Math.round(args.usdc * 10 ** pool.tokenY.mint.decimals));
  const binArrays = await pool.getBinArrays();
  const quote = pool.swapQuote(inAmount, false, SLIPPAGE_BPS, binArrays);
  const swapTx = await pool.swap({
    inToken: usdcMint,
    outToken: nebMint,
    inAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: pool.pubkey,
    user: wallet.publicKey,
    binArraysPubkey: quote.binArraysPubkey,
  });
  const swapSig = await sendAndConfirmTransaction(connection, swapTx, [wallet]);
  console.log(`   bought ~${Number(quote.outAmount) / 10 ** decimals} NEB (tx ${swapSig.slice(0, 12)}…)`);

  const nebAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const balance = await connection.getTokenAccountBalance(nebAta);
  const totalRaw = BigInt(balance.value.amount);
  if (totalRaw === 0n) throw new Error("swap landed but the NEB balance is 0 — nothing to stake");
  console.log(`   wallet NEB balance: ${balance.value.uiAmountString}`);

  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  const program = new Program<NebulousWorld>(idl as NebulousWorld, provider);

  const seederUser = await prisma.user.upsert({
    where: { wallet: wallet.publicKey.toBase58() },
    // No `handle` — it's unique, and a fixed string would collide across
    // runs (each run generates a brand-new wallet, so `create` fires every
    // time). Leaving it null is fine; nothing requires a seeding wallet to
    // have a display handle.
    create: { wallet: wallet.publicKey.toBase58() },
    update: {},
  });

  const apps = await prisma.app.findMany({
    include: { appTags: { include: { tag: true } } },
  });
  console.log(`\n📊 Staking across ${apps.length} apps (and their tags), concurrency ${args.concurrency}`);

  // One random weight per operation (one vote per app, one stake per
  // app-tag), so the real bought amount is split unevenly across all of
  // them — same "a few, unevenly sized positions" shape prisma/seed.ts's
  // fake data has, just derived from `totalRaw` instead of made up.
  const numAppTags = apps.reduce((sum, a) => sum + a.appTags.length, 0);
  const weights = Array.from({ length: apps.length + numAppTags }, () => 0.3 + rand());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let weightIdx = 0;
  function nextAmountRaw(): bigint {
    const share = weights[weightIdx++]! / weightSum;
    const raw = BigInt(Math.floor(Number(totalRaw) * share));
    return raw > 0n ? raw : 1n;
  }

  let voteCount = 0;
  let stakeCount = 0;

  await mapWithConcurrency(apps, args.concurrency, async (app) => {
    console.log(`  ${app.name}`);
    const appPk = appPda(programId, app.id);

    await ensureOnChain(`init_app(${app.slug})`, () =>
      program.methods
        .initApp(app.id)
        .accountsPartial({ app: appPk, payer: wallet.publicKey, systemProgram: SystemProgram.programId })
        .rpc(),
    );

    const voteAmountRaw = nextAmountRaw();
    const appTagAmounts = app.appTags.map(() => nextAmountRaw());

    await Promise.all([
      (async () => {
        const [positionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vote_pos"), appPk.toBuffer(), wallet.publicKey.toBuffer()],
          programId,
        );
        const sig = await program.methods
          .vote(new BN(voteAmountRaw.toString()))
          .accountsPartial({
            app: appPk,
            position: positionPda,
            config: cfgPda,
            vault,
            userTokenAccount: nebAta,
            user: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        await prisma.vote.create({
          data: {
            appId: app.id,
            userId: seederUser.id,
            amount: Number(voteAmountRaw) / 10 ** decimals,
            txSig: sig,
          },
        });
        voteCount++;
      })(),
      ...app.appTags.map(async (appTag, i) => {
        const tagSlug = appTag.tag.slug;
        const [tagPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("tag"), Buffer.from(tagSlug)],
          programId,
        );
        const [appTagStakePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("app_tag_stake"), appPk.toBuffer(), tagPda.toBuffer()],
          programId,
        );

        await ensureOnChain(`suggest_tag(${app.slug}, ${tagSlug})`, () =>
          program.methods
            .suggestTag(app.id, tagSlug)
            .accountsPartial({
              app: appPk,
              tag: tagPda,
              appTagStake: appTagStakePda,
              payer: wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        );

        const [positionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake_pos"), appTagStakePda.toBuffer(), wallet.publicKey.toBuffer()],
          programId,
        );
        const amountRaw = appTagAmounts[i]!;
        const sig = await program.methods
          .stakeTag(new BN(amountRaw.toString()))
          .accountsPartial({
            app: appPk,
            appTagStake: appTagStakePda,
            position: positionPda,
            config: cfgPda,
            vault,
            userTokenAccount: nebAta,
            user: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        await prisma.stake.create({
          data: {
            appTagId: appTag.id,
            userId: seederUser.id,
            amount: Number(amountRaw) / 10 ** decimals,
            active: true,
            txSig: sig,
          },
        });
        await refreshAppTag(appTag.id);
        stakeCount++;
      }),
    ]);

    await refreshApp(app.id);
    console.log(`    ✓ voted + staked ${app.appTags.length} tag(s)`);
  });

  console.log(
    `\n✅ Done: ${voteCount} on-chain votes, ${stakeCount} on-chain tag stakes, wallet ${wallet.publicKey.toBase58()}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
