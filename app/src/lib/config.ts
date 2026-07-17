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
  // Base URL of the indexer's HTTP API (indexer/src/api.rs) — server-only,
  // never exposed to the browser. Every on-chain read/write in this app
  // (pool status, vote/stake/claim positions, transaction building and
  // submission) goes through this instead of a direct Solana RPC
  // connection — see lib/indexerClient.ts.
  indexerApiUrl: process.env.INDEXER_API_URL || "http://127.0.0.1:8090",
} as const;

/**
 * When no vote token mint is configured we run in "simulation" mode: votes and
 * stakes are recorded off-chain (in the database) without requiring a real
 * on-chain SPL token transfer. This lets the whole product be exercised
 * end-to-end without a funded devnet wallet, while the same UI/flows work
 * unchanged once a real mint + program are configured.
 */
export const isSimulationMode = () => !config.solana.voteTokenMint;
