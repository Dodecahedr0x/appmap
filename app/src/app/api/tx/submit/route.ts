import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { submitTxSchema } from "@/lib/validation";
import { submitSignedTx } from "@/lib/indexerClient";

// POST /api/tx/submit — relays an already wallet-signed transaction to the
// network via the indexer (sendRawTransaction + confirm). This is the only
// way any transaction (vote/stake/claim/buy) ever reaches the chain now —
// the app itself has no RPC connection to send one with directly.
export const POST = handler(async (req: NextRequest) => {
  const body = submitTxSchema.parse(await req.json());
  const result = await submitSignedTx(body.signedTransaction);
  return ok(result);
});
