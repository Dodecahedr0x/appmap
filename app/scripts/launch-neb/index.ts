// NEB launch: mints the full NEB supply with on-chain Metaplex metadata,
// then creates a NEB/USDC Meteora DLMM pool and seeds it single-sided with
// that entire supply. Replaces the old native single-sided bonding-curve
// program instructions (init_neb_pool/buy_neb) — buying now happens by
// swapping through the DLMM pool directly (via Jupiter or the DLMM SDK),
// not through our own program.
//
// Usage:
//   tsx scripts/launch-neb/index.ts [--config=./launch-neb.config.json]
//
// See launch-neb.config.example.jsonc for the config shape. Defaults to
// dryRun: true — nothing is sent on-chain until you explicitly set
// "dryRun": false in your config.

import { readFileSync } from "fs";
import { Connection, Keypair } from "@solana/web3.js";
import { loadConfig } from "./config";
import { createTokenWithMetadata } from "./token";
import { createLaunchPool } from "./pool";

function parseArgs(argv: string[]): { configPath: string } {
  const configArg = argv.find((a) => a.startsWith("--config="));
  return { configPath: configArg ? configArg.slice("--config=".length) : "./launch-neb.config.json" };
}

async function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  console.log(`Loading config from ${configPath}`);
  const config = loadConfig(configPath);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(config.keypairFilePath, "utf-8"))));

  console.log(`\nCluster: ${config.cluster}`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Dry run: ${config.dryRun}`);
  if (config.dryRun) {
    console.log(`(set "dryRun": false in ${configPath} to actually send transactions)`);
  }

  const { mint, totalSupplyRaw } = await createTokenWithMetadata(connection, payer, config);
  const pool = await createLaunchPool(connection, payer, mint, totalSupplyRaw, config);

  console.log(`\n== Done ==`);
  console.log(`NEB mint: ${mint.toBase58()}`);
  console.log(`DLMM pool: ${pool?.poolAddress.toBase58() ?? "(not created — dry run)"}`);
  if (!config.dryRun && pool) {
    console.log(`\nSet these in app/.env:`);
    console.log(`  NEXT_PUBLIC_VOTE_TOKEN_MINT="${mint.toBase58()}"`);
    console.log(`  NEXT_PUBLIC_NEB_DLMM_POOL="${pool.poolAddress.toBase58()}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
