import type { Metadata } from "next";
import { BuyPanel } from "@/components/token/BuyPanel";
import { TOKEN_NAME, TOKEN_SYMBOL } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Buy ${TOKEN_SYMBOL}`,
  description: `Buy ${TOKEN_NAME} (${TOKEN_SYMBOL}) — AppMap's vote/stake token — off the initial single-sided sale pool.`,
};

export default function TokenPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-heading-lg font-semibold text-ink">
          {TOKEN_NAME} ({TOKEN_SYMBOL})
        </h1>
        <p className="mt-2 text-sm text-slate">
          {TOKEN_SYMBOL} is the token behind every vote and tag stake on AppMap. Its entire
          initial supply is sold from a single-sided bonding-curve pool — seeded with only{" "}
          {TOKEN_SYMBOL}, no SOL — so the price rises purely from demand as the supply depletes.
        </p>
      </div>
      <BuyPanel />
    </div>
  );
}
