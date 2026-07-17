// Creates the NEB/USDC Meteora DLMM launch pool and seeds it with the full
// NEB supply as single-sided liquidity (no USDC deposited), spread across
// every bin from the starting price up to initialPrice * maxPriceMultiplier
// — the pool acts as a liquidity provider across that whole range: it starts
// at one price and sells down through NEB as buyers swap USDC in, with the
// price climbing through progressively higher bins as each empties, rather
// than a single fixed-price cliff.

import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import DLMM, {
  ActivationType,
  ConcreteFunctionType,
  LBCLMM_PROGRAM_IDS,
  StrategyType,
  deriveCustomizablePermissionlessLbPair,
} from "@meteora-ag/dlmm";
import type { LaunchConfig } from "./config";

export interface LaunchedPool {
  poolAddress: PublicKey;
}

/** Build, sign and send a transaction from raw instructions with a fresh blockhash. */
async function sendIxs(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners]);
}

/**
 * Creates the customizable permissionless DLMM pair for NEB/quoteMint, then
 * deposits `totalSupplyRaw` NEB single-sided across the bin range from the
 * configured starting price up to `initialPrice * maxPriceMultiplier`, using
 * a uniform (Spot) distribution — a standard LP position (owned by `payer`,
 * same as any other DLMM liquidity provider — no special "operator"/"seed"
 * role). When `dryRun` is set, logs the plan without sending any transactions.
 */
export async function createLaunchPool(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  totalSupplyRaw: bigint,
  config: LaunchConfig,
): Promise<LaunchedPool | null> {
  const { pool, quoteMint, dryRun } = config;
  const quoteMintKey = new PublicKey(quoteMint);
  const binStep = new BN(pool.binStep);
  // getBinIdFromPrice's `min` flag picks which side of the bin boundary to
  // land on when the exact price falls between two bins — at typical bin
  // steps (tens of bps) this is a sub-basis-point difference from the
  // configured initialPrice either way, so "up"/"down" only needs to be
  // internally consistent (same rounding used for both ends of the range),
  // not independently correct.
  const roundDown = pool.priceRounding === "down";
  const activeId = new BN(DLMM.getBinIdFromPrice(pool.initialPrice, pool.binStep, roundDown));
  const maxPrice = pool.initialPrice * pool.maxPriceMultiplier;
  const maxBinId = new BN(DLMM.getBinIdFromPrice(maxPrice, pool.binStep, roundDown));
  if (maxBinId.lte(activeId)) {
    throw new Error(
      `pool.maxPriceMultiplier (${pool.maxPriceMultiplier}) must be greater than 1 — the seeded range ` +
        `collapses to a single bin otherwise`,
    );
  }
  const binCount = maxBinId.sub(activeId).toNumber() + 1;
  const activationType = pool.activationType === "slot" ? ActivationType.Slot : ActivationType.Timestamp;

  console.log(`\n== DLMM pool ==`);
  console.log(`  base (NEB): ${mint.toBase58()}`);
  console.log(`  quote: ${quoteMintKey.toBase58()}`);
  console.log(`  binStep: ${pool.binStep} bps, feeBps: ${pool.feeBps}`);
  console.log(`  price range: ${pool.initialPrice} → ${maxPrice} (activeId ${activeId.toString()} → maxBinId ${maxBinId.toString()}, ${binCount} bins)`);
  console.log(`  activationType: ${pool.activationType}, activationPoint: ${pool.activationPoint ?? "immediate"}`);
  console.log(`  creatorPoolOnOffControl: ${pool.creatorPoolOnOffControl}`);
  console.log(`  seeding: full supply (${totalSupplyRaw} raw units) single-sided, Spot distribution across ${binCount} bins`);

  if (dryRun) {
    console.log(`  [dry run] would create the pool and seed it with the full NEB supply — no transaction sent.`);
    return null;
  }

  if (process.env.DEBUG_LAUNCH_NEB) {
    const creatorNebAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const nebBal = await connection.getTokenAccountBalance(creatorNebAta).catch((e) => `error: ${e.message}`);
    const creatorQuoteAta = getAssociatedTokenAddressSync(quoteMintKey, payer.publicKey);
    const quoteBal = await connection.getTokenAccountBalance(creatorQuoteAta).catch((e) => `error: ${e.message}`);
    console.log(`  [debug] creator NEB balance: ${JSON.stringify(nebBal)}`);
    console.log(`  [debug] creator quote balance: ${JSON.stringify(quoteBal)}`);
  }

  // The pool creator's wallet must hold a nonzero balance of BOTH tokenX and
  // tokenY before this transaction — the on-chain program rejects
  // ("MissingTokenAmountAsTokenLaunchProof") pool creation from a wallet
  // holding only the base token, as an anti-rug check that whoever creates
  // the pool is a genuine participant on both sides, not just dumping a
  // freshly minted token into an empty pool. A tiny, non-dust amount of the
  // quote token (config.quoteMint) is enough — see the config template.
  const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair2(
    connection,
    binStep,
    mint,
    quoteMintKey,
    activeId,
    new BN(pool.feeBps),
    activationType,
    false, // hasAlphaVault — no bootstrapping vault, this is a straight launch pool
    payer.publicKey,
    pool.activationPoint ? new BN(pool.activationPoint) : undefined,
    pool.creatorPoolOnOffControl,
    ConcreteFunctionType.LiquidityMining,
    undefined,
    { cluster: config.cluster },
  );
  const createPoolSig = await sendAndConfirmTransaction(connection, createPoolTx, [payer]);
  console.log(`  pool created. tx: ${createPoolSig}`);

  const dlmmProgramId = new PublicKey(LBCLMM_PROGRAM_IDS[config.cluster]);
  const [poolAddress] = deriveCustomizablePermissionlessLbPair(mint, quoteMintKey, dlmmProgramId);

  const dlmmPool = await DLMM.create(connection, poolAddress, { cluster: config.cluster });

  // Seed the full supply single-sided via the standard (permissionless, no
  // "operator" role) position API — a Spot (uniform) distribution across
  // every bin from activeId to maxBinId, with singleSidedX so only NEB
  // (tokenX) is deposited, none of the quote token. This is the multi-
  // position variant of the same call any regular DLMM LP makes (positions
  // can hold up to 1400 bins each, chunked into several deposit
  // transactions for size/compute reasons — a 100x range at a 100bps bin
  // step is ~460 bins, comfortably one position). It doesn't need the
  // specialized seedLiquidity/seedLiquiditySingleBin "launch tooling"
  // methods, which (as tested against a real cloned devnet DLMM program)
  // reject with AnchorError 6031 "UnauthorizedAccess" in
  // initialize_position_by_operator.rs for a permissionlessly-created pool
  // regardless of which pubkey is passed as `operator` — that whole code
  // path appears reserved for Meteora-coordinated launches, not general
  // permissionless use.
  const { instructionsByPositions } = await dlmmPool.initializeMultiplePositionAndAddLiquidityByStrategy(
    (count) => Promise.all(Array.from({ length: count }, () => Keypair.generate())),
    new BN(totalSupplyRaw.toString()),
    new BN(0),
    {
      minBinId: activeId.toNumber(),
      maxBinId: maxBinId.toNumber(),
      strategyType: StrategyType.Spot,
      singleSidedX: true,
    },
    payer.publicKey,
    payer.publicKey,
    0, // slippage — brand-new pool/position, nothing to slip against
  );

  for (const [i, entry] of instructionsByPositions.entries()) {
    // initializeAtaIxs is idempotent-create, so it only needs to ride along
    // on the first position's transaction.
    const initIxs = i === 0 ? [...entry.initializeAtaIxs, entry.initializePositionIx] : [entry.initializePositionIx];
    const initSig = await sendIxs(connection, payer, initIxs, [entry.positionKeypair]);
    console.log(
      `  position ${i + 1}/${instructionsByPositions.length} created (${entry.positionKeypair.publicKey.toBase58()}). tx: ${initSig}`,
    );

    for (const [chunkIndex, chunkIxs] of entry.addLiquidityIxs.entries()) {
      const chunkSig = await sendIxs(connection, payer, chunkIxs);
      console.log(
        `  liquidity chunk ${chunkIndex + 1}/${entry.addLiquidityIxs.length} seeded for position ${i + 1}. tx: ${chunkSig}`,
      );
    }
  }

  return { poolAddress };
}
