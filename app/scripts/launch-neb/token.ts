// Creates the NEB mint, attaches on-chain Metaplex metadata, and mints the
// full configured supply to the payer — the "full supply minted at
// inception" half of the launch. Pool creation/seeding is in pool.ts.

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  setAuthority,
  AuthorityType,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PROGRAM_ID as METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import type { LaunchConfig } from "./config";

export interface CreatedToken {
  mint: PublicKey;
  payerAta: PublicKey;
  totalSupplyRaw: bigint;
}

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];
}

/**
 * Creates the NEB mint with on-chain metadata and mints the full configured
 * supply to `payer`'s associated token account. When `dryRun` is set, builds
 * and logs every instruction but sends nothing.
 */
export async function createTokenWithMetadata(
  connection: Connection,
  payer: Keypair,
  config: LaunchConfig,
): Promise<CreatedToken> {
  const { token, dryRun } = config;
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const totalSupplyRaw = BigInt(Math.round(token.totalSupply * 10 ** token.decimals));
  const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const metadataPda = deriveMetadataPda(mint);

  console.log(`\n== Token ==`);
  console.log(`  mint (new keypair): ${mint.toBase58()}`);
  console.log(`  name/symbol: ${token.name} (${token.symbol})`);
  console.log(`  decimals: ${token.decimals}`);
  console.log(`  total supply: ${token.totalSupply} (${totalSupplyRaw} raw units)`);
  console.log(`  metadata PDA: ${metadataPda.toBase58()}`);
  console.log(`  revoke mint authority after minting: ${token.revokeMintAuthority}`);

  const rentExemptLamports = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports: rentExemptLamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint, token.decimals, payer.publicKey, null, TOKEN_PROGRAM_ID),
    createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda,
        mint,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: token.name,
            symbol: token.symbol,
            uri: token.uri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: token.isMutable,
          collectionDetails: null,
        },
      },
    ),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, payerAta, payer.publicKey, mint),
    createMintToInstruction(mint, payerAta, payer.publicKey, totalSupplyRaw),
  );

  if (dryRun) {
    console.log(`  [dry run] would create mint, attach metadata, and mint full supply — no transaction sent.`);
  } else {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
    console.log(`  minted. tx: ${sig}`);

    if (token.revokeMintAuthority) {
      const revokeSig = await setAuthority(
        connection,
        payer,
        mint,
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
      );
      console.log(`  mint authority revoked. tx: ${revokeSig}`);
    }
  }

  return { mint, payerAta, totalSupplyRaw };
}
