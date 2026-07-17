import type { Category } from "../../../src/lib/constants";
import type { DataSource, RawApp } from "../types";

// Best-effort mapping from DefiLlama's category taxonomy to ours. Unmapped
// categories fall back to "other" rather than failing the whole record.
const CATEGORY_MAP: Record<string, Category> = {
  Dexs: "defi",
  "Liquid Staking": "defi",
  Lending: "defi",
  Yield: "defi",
  "Yield Aggregator": "defi",
  CDP: "defi",
  Derivatives: "defi",
  Options: "defi",
  Synthetics: "defi",
  Restaking: "defi",
  "Staking Pool": "defi",
  RWA: "defi",
  Insurance: "defi",
  "Prediction Market": "defi",
  "Basis Trading": "defi",
  "Algo-Stables": "defi",
  Payments: "payments",
  "NFT Marketplace": "marketplace",
  "NFT Lending": "marketplace",
  Launchpad: "marketplace",
  Gaming: "gaming",
  Services: "infrastructure",
  Bridge: "infrastructure",
  "Cross Chain": "infrastructure",
  Oracle: "infrastructure",
  Indexer: "developer-tools",
  Wallets: "wallet",
  Social: "social",
  "Prediction Markets": "analytics",
};

interface DefiLlamaProtocol {
  id: string;
  name: string;
  url?: string;
  description?: string;
  logo?: string;
  category?: string;
  chain?: string;
  tvl?: number;
}

function mapCategory(raw: string | undefined): Category {
  return CATEGORY_MAP[raw ?? ""] ?? "other";
}

/**
 * DefiLlama publishes an open, unauthenticated directory of protocols with
 * TVL, description, and category — a good real-world seed for Solana-native
 * apps. `chain === "Solana"` (DefiLlama's primary-chain field, not the
 * multi-chain `chains` array) keeps this to genuinely Solana-native products
 * rather than every multi-chain app that merely supports Solana.
 */
export const defiLlamaSource: DataSource = {
  id: "defillama",

  async fetch(): Promise<RawApp[]> {
    const res = await fetch("https://api.llama.fi/protocols");
    if (!res.ok) {
      throw new Error(`DefiLlama fetch failed: ${res.status} ${res.statusText}`);
    }
    const protocols = (await res.json()) as DefiLlamaProtocol[];

    return protocols
      .filter((p) => p.chain === "Solana" && p.name && p.url && p.description)
      .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
      .map((p) => ({
        sourceId: "defillama",
        externalId: p.id,
        name: p.name,
        url: p.url!,
        description: p.description!,
        iconUrl: p.logo,
        category: mapCategory(p.category),
      }));
  },
};
