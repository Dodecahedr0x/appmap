import { PublicKey } from "@solana/web3.js";

// Wallet identity is proof-of-key-ownership at the point of each on-chain
// transaction (the wallet signs the actual transfer/vote/stake instruction),
// not a separate signed-message login — so all this needs to check is that
// a claimed wallet address is well-formed.

/** Validate that a string is a well-formed Solana public key. */
export function isValidWallet(wallet: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(wallet);
    return true;
  } catch {
    return false;
  }
}
