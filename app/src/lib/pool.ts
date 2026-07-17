// Single-sided bonding-curve pool math for the NEB sale — the pure-function
// mirror of `pool_math::compute_buy_out` in the Anchor program
// (programs/appmap/src/pool_math.rs). Operates in human-scale float units
// (NEB, SOL), the same "plain numbers" convention as ranking.ts/revenue.ts —
// NOT raw lamports/raw token units; see anchorClient.ts's `toRawAmount` for
// that conversion when calling the on-chain program directly. Kept in
// lockstep with the Rust version by hand (one is u64 fixed-point, the other
// float), so any change to the curve formula must be mirrored in both.

export interface PoolState {
  totalSupply: number;
  remainingSupply: number;
  solRaised: number;
  virtualSolReserves: number;
}

/**
 * How many NEB `solIn` buys off the bonding curve, given the pool's current
 * state.
 *
 * Constant-product curve: `k = virtualSolReserves * totalSupply` (fixed at
 * pool creation, since remainingSupply == totalSupply and solRaised == 0
 * then). Effective SOL reserve is `virtualSolReserves + solRaised`
 * (virtual seed + real proceeds); effective token reserve is
 * `remainingSupply` (no virtual token side — the whole totalSupply was
 * genuinely deposited single-sided).
 *
 * Throws if the pool is already sold out, `solIn` isn't positive, or the
 * trade is too small to earn any NEB at the current price.
 */
export function computeBuyQuote(pool: PoolState, solIn: number): number {
  if (solIn <= 0) throw new Error("solIn must be positive");
  if (pool.remainingSupply <= 0) throw new Error("Pool is sold out");

  const k = pool.virtualSolReserves * pool.totalSupply;
  const solReserveAfter = pool.virtualSolReserves + pool.solRaised + solIn;
  const tokenReserveAfter = k / solReserveAfter;

  const tokensOut = Math.min(
    pool.remainingSupply,
    Math.max(0, pool.remainingSupply - tokenReserveAfter),
  );
  if (tokensOut <= 0) throw new Error("Trade too small to receive any NEB");
  return tokensOut;
}

/** Marginal spot price, in SOL per NEB, at the pool's current state. */
export function spotPrice(pool: PoolState): number {
  if (pool.remainingSupply <= 0) return Infinity;
  return (pool.virtualSolReserves + pool.solRaised) / pool.remainingSupply;
}

/** Fraction of totalSupply sold so far, in [0, 1]. */
export function soldFraction(pool: PoolState): number {
  if (pool.totalSupply <= 0) return 0;
  return (pool.totalSupply - pool.remainingSupply) / pool.totalSupply;
}

/** The shape /api/pool and /api/pool/buy serialize their `pool` field as. */
export interface PoolStatus extends PoolState {
  soldFraction: number;
  spotPrice: number;
}

/**
 * Builds the API-facing pool status from a DB row — includes the full
 * `PoolState` (so `computeBuyQuote` can be called client-side against this
 * same object) plus the derived display fields.
 */
export function serializePoolStatus(pool: PoolState): PoolStatus {
  return {
    totalSupply: pool.totalSupply,
    remainingSupply: pool.remainingSupply,
    solRaised: pool.solRaised,
    virtualSolReserves: pool.virtualSolReserves,
    soldFraction: soldFraction(pool),
    spotPrice: spotPrice(pool),
  };
}
