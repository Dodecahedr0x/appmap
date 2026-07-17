// Creates the NEB/USDC Meteora DLMM launch pool and seeds it with the full
// NEB supply as single-sided liquidity (no USDC deposited) — the DLMM
// equivalent of the single-sided bonding curve this replaces: the pool
// starts at one price and sells down through NEB as buyers swap USDC in.

import BN from "bn.js";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
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

/**
 * Creates the customizable permissionless DLMM pair for NEB/quoteMint, then
 * deposits `totalSupplyRaw` NEB into a single bin at the configured starting
 * price as a standard single-sided LP position (owned by `payer`, same as
 * any other DLMM liquidity provider — no special "operator"/"seed" role).
 * When `dryRun` is set, logs the plan without sending any transactions.
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
  // internally consistent (same bin gets both the pool's active bin and the
  // seeded liquidity), not independently correct.
  const roundDown = pool.priceRounding === "down";
  const activeId = new BN(DLMM.getBinIdFromPrice(pool.initialPrice, pool.binStep, roundDown));
  const activationType = pool.activationType === "slot" ? ActivationType.Slot : ActivationType.Timestamp;

  console.log(`\n== DLMM pool ==`);
  console.log(`  base (NEB): ${mint.toBase58()}`);
  console.log(`  quote: ${quoteMintKey.toBase58()}`);
  console.log(`  binStep: ${pool.binStep} bps, feeBps: ${pool.feeBps}`);
  console.log(`  initialPrice: ${pool.initialPrice} (activeId ${activeId.toString()})`);
  console.log(`  activationType: ${pool.activationType}, activationPoint: ${pool.activationPoint ?? "immediate"}`);
  console.log(`  creatorPoolOnOffControl: ${pool.creatorPoolOnOffControl}`);
  console.log(`  seeding: full supply (${totalSupplyRaw} raw units) single-sided into one bin`);

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
  // "operator" role) position API — a single-bin Spot position at the
  // active bin with singleSidedX so only NEB (tokenX) is deposited, none of
  // the quote token. This is the same call any regular DLMM LP makes; it
  // doesn't need the specialized seedLiquidity/seedLiquiditySingleBin
  // "launch tooling" methods, which (as tested against a real cloned devnet
  // DLMM program) reject with AnchorError 6031 "UnauthorizedAccess" in
  // initialize_position_by_operator.rs for a permissionlessly-created pool
  // regardless of which pubkey is passed as `operator` — that whole code
  // path appears reserved for Meteora-coordinated launches, not general
  // permissionless use.
  const position = Keypair.generate();
  const addLiquidityTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: position.publicKey,
    totalXAmount: new BN(totalSupplyRaw.toString()),
    totalYAmount: new BN(0),
    strategy: {
      minBinId: activeId.toNumber(),
      maxBinId: activeId.toNumber(),
      strategyType: StrategyType.Spot,
      singleSidedX: true,
    },
    user: payer.publicKey,
  });
  const addLiquiditySig = await sendAndConfirmTransaction(connection, addLiquidityTx, [payer, position]);
  console.log(`  liquidity seeded. tx: ${addLiquiditySig}`);

  return { poolAddress };
}
