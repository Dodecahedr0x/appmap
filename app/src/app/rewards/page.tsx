import type { Metadata } from "next";
import { fetchPoolStatus } from "@/lib/indexerClient";
import { TOKEN_NAME, TOKEN_SYMBOL } from "@/lib/constants";
import { BuyPanel } from "@/components/token/BuyPanel";
import { PoolAnalytics } from "@/components/rewards/PoolAnalytics";
import { ClaimRewards } from "@/components/rewards/ClaimRewards";
import { CloseZeroStakeAccounts } from "@/components/rewards/CloseZeroStakeAccounts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rewards",
  description: `Buy ${TOKEN_SYMBOL}, track the pool, and claim your vote/stake rewards — everything ${TOKEN_SYMBOL}-related on nebulous.world, in one place.`,
};

export default async function RewardsPage() {
  const pool = await fetchPoolStatus();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-heading-lg font-normal text-ink">Rewards</h1>
        <p className="mt-2 text-pretty text-sm text-slate">
          Everything {TOKEN_SYMBOL} lives here: buy {TOKEN_NAME} on the public NEB/USDC pool, watch
          its live indicators, and claim what your votes and tag stakes have earned — without
          withdrawing your principal.
        </p>
      </div>

      <BuyPanel />
      <PoolAnalytics pool={pool} />
      <ClaimRewards />
      <CloseZeroStakeAccounts />
    </div>
  );
}
