// The tx-building half of what used to be app/src/hooks/useNebDlmmSwap.ts —
// everything up to (but not including) signing. Signing happens in the
// user's browser wallet; this only returns an unsigned, blockhash-baked
// transaction for the app to have the wallet sign and then submit via the
// indexer's /tx/submit (see src/api.rs).

import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { loadNebPool } from "./pool";

const SLIPPAGE_BPS = new BN(100); // 1%

export interface BuiltSwap {
  transaction: string;
  /** Expected NEB output at quote time, UI units — for the "Bought X NEB" toast. */
  nebOut: number;
}

export async function buildBuyNebTx(
  connection: Connection,
  usdcAmount: number,
  user: PublicKey,
): Promise<BuiltSwap> {
  const pool = await loadNebPool(connection);
  if (!pool) throw new Error("NEB isn't tradable yet — no pool configured");
  await pool.refetchStates();

  const usdcMint = pool.tokenY.publicKey;
  const nebMint = pool.tokenX.publicKey;
  const inAmount = new BN(Math.round(usdcAmount * 10 ** pool.tokenY.mint.decimals));

  const binArrays = await pool.getBinArrays();
  const quote = pool.swapQuote(inAmount, false, SLIPPAGE_BPS, binArrays);

  const tx = await pool.swap({
    inToken: usdcMint,
    outToken: nebMint,
    inAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: pool.pubkey,
    user,
    binArraysPubkey: quote.binArraysPubkey,
  });

  // Unsigned wire-format bytes — the same format wallet-adapter's own
  // signTransaction()/sendTransaction() paths produce internally (see
  // @solana/wallet-standard-wallet-adapter-base's prepareTransaction), so
  // the app can `Transaction.from(...)` this directly.
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transaction: Buffer.from(bytes).toString("base64"),
    nebOut: Number(quote.outAmount) / 10 ** pool.tokenX.mint.decimals,
  };
}
