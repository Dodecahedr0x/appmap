import type { Metadata } from "next";
import { BuyPanel } from "@/components/token/BuyPanel";
import { TOKEN_NAME, TOKEN_SYMBOL } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Buy ${TOKEN_SYMBOL}`,
  description: `Buy ${TOKEN_NAME} (${TOKEN_SYMBOL}) — nebulous.world's vote/stake token — on the NEB/USDC Meteora DLMM pool.`,
};

export default function TokenPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-heading-lg font-semibold text-ink">
          {TOKEN_NAME} ({TOKEN_SYMBOL})
        </h1>
        <p className="mt-2 text-sm text-slate">
          {TOKEN_SYMBOL} is the token behind every vote and tag stake on nebulous.world. Its
          entire supply was minted at launch and seeded single-sided into a public NEB/USDC
          Meteora DLMM pool — buying {TOKEN_SYMBOL} is a direct swap against that pool.
        </p>
      </div>
      <BuyPanel />
    </div>
  );
}
