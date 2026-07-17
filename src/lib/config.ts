// Centralised runtime configuration. Values prefixed NEXT_PUBLIC_ are safe to
// expose to the browser; everything else must only be read server-side.

export const config = {
  solana: {
    rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
    cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet") as
      | "devnet"
      | "testnet"
      | "mainnet-beta",
    voteTokenMint: process.env.NEXT_PUBLIC_VOTE_TOKEN_MINT || "",
    voteTokenDecimals: Number(
      process.env.NEXT_PUBLIC_VOTE_TOKEN_DECIMALS || "6",
    ),
    programId: process.env.NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID || "",
    treasury: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "",
  },
  ads: {
    // Default CPM (revenue in token units per 1000 impressions).
    cpm: Number(process.env.AD_CPM || "2.5"),
  },
  tracking: {
    secret: process.env.TRACKING_SECRET || "dev-tracking-secret-change-me",
  },
} as const;

/**
 * When no vote token mint is configured we run in "simulation" mode: votes and
 * stakes are recorded off-chain (in the database) without requiring a real
 * on-chain SPL token transfer. This lets the whole product be exercised
 * end-to-end without a funded devnet wallet, while the same UI/flows work
 * unchanged once a real mint + program are configured.
 */
export const isSimulationMode = () => !config.solana.voteTokenMint;
