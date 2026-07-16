import { PrismaClient } from "@prisma/client";
import { computeRankScore, ageInDays } from "../src/lib/ranking";
import { slugify } from "../src/lib/utils";

// Seeds a realistic dataset so search, ranking, staking, and analytics all have
// something to show on first run. Idempotent-ish: it clears core tables first.

const prisma = new PrismaClient();

// Deterministic pseudo-random so seed output is stable across runs.
let seed = 1337;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// Fake but valid-looking wallet addresses (base58, 44 chars-ish). Only used in
// simulation mode; real wallets replace these once users sign in.
const WALLETS = [
  "7xKQ9fA2mNpVbY3sJ4wZ8cR1tD6uH5gL9eQ2nX0aB3k",
  "3mP8kL2nQ9wErT4yU6iO1pA5sD7fG0hJ2kL4zX8cV6b",
  "9aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aC8",
  "5tY7uI9oP1aS3dF5gH7jK9lZ2xC4vB6nM8qW0eR2tY4",
  "2wE4rT6yU8iO0pL2kJ4hG6fD8sA0zX2cV4bN6mQ8wE0",
  "8kJ2hG4fD6sA8zX0cV2bN4mQ6wE8rT0yU2iO4pL6kJ8",
];

const CATEGORIES = ["defi", "nft", "gaming", "dao", "infrastructure", "wallet", "social", "analytics"];

const APPS = [
  { name: "Jupiter", tagline: "The key liquidity aggregator for Solana", category: "defi", tags: ["swap", "aggregator", "trading", "dex"] },
  { name: "Tensor", tagline: "The fastest NFT marketplace on Solana", category: "nft", tags: ["marketplace", "nft", "trading"] },
  { name: "Marinade", tagline: "Liquid staking protocol", category: "defi", tags: ["staking", "liquid-staking", "yield"] },
  { name: "Phantom", tagline: "A friendly crypto wallet built for DeFi & NFTs", category: "wallet", tags: ["wallet", "self-custody", "mobile"] },
  { name: "Drift", tagline: "Decentralized perpetuals exchange", category: "defi", tags: ["perps", "trading", "derivatives", "dex"] },
  { name: "Magic Eden", tagline: "The community-centric NFT marketplace", category: "nft", tags: ["marketplace", "nft", "launchpad"] },
  { name: "Star Atlas", tagline: "Grand strategy game of interstellar conquest", category: "gaming", tags: ["game", "metaverse", "strategy"] },
  { name: "Realms", tagline: "DAO tooling and governance for Solana", category: "dao", tags: ["dao", "governance", "voting"] },
  { name: "Helius", tagline: "The best Solana RPC & developer platform", category: "infrastructure", tags: ["rpc", "developer-tools", "infrastructure", "api"] },
  { name: "Kamino", tagline: "Automated liquidity & lending", category: "defi", tags: ["lending", "yield", "automation"] },
  { name: "Dialect", tagline: "Smart messaging & notifications", category: "social", tags: ["messaging", "notifications", "social"] },
  { name: "Step Finance", tagline: "Portfolio dashboard for Solana", category: "analytics", tags: ["portfolio", "analytics", "dashboard"] },
  { name: "Orca", tagline: "The friendliest DEX on Solana", category: "defi", tags: ["dex", "swap", "amm", "trading"] },
  { name: "Backpack", tagline: "A home for your xNFTs", category: "wallet", tags: ["wallet", "xnft", "exchange"] },
  { name: "Zeta Markets", tagline: "Under-collateralized DeFi derivatives", category: "defi", tags: ["derivatives", "options", "perps"] },
];

const ADS = [
  { title: "Trade with zero fees", body: "Join the fastest DEX on Solana", targetUrl: "https://example.com/dex", cpm: 3.2 },
  { title: "Earn 8% APY staking SOL", body: "Liquid staking, instant unstake", targetUrl: "https://example.com/stake", cpm: 4.1 },
  { title: "Mint your first NFT", body: "Zero-code launchpad", targetUrl: "https://example.com/mint", cpm: 2.4 },
  { title: "Build on Solana", body: "Free RPC for developers", targetUrl: "https://example.com/rpc", cpm: 2.9 },
];

async function main() {
  console.log("🌱 Seeding AppMap…");

  // Clear in FK-safe order.
  await prisma.revenueClaim.deleteMany();
  await prisma.adImpression.deleteMany();
  await prisma.revenueEpoch.deleteMany();
  await prisma.pageView.deleteMany();
  await prisma.ad.deleteMany();
  await prisma.stake.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.appTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.app.deleteMany();
  await prisma.user.deleteMany();

  // Users.
  const users = await Promise.all(
    WALLETS.map((wallet, i) =>
      prisma.user.create({
        data: { wallet, handle: i === 0 ? "founder" : null },
      }),
    ),
  );

  // Ads.
  const ads = await Promise.all(ADS.map((a) => prisma.ad.create({ data: a })));

  // Tag cache.
  const tagCache = new Map<string, string>();
  async function tagId(name: string): Promise<string> {
    const slug = slugify(name);
    if (tagCache.has(slug)) return tagCache.get(slug)!;
    const tag = await prisma.tag.upsert({
      where: { slug },
      create: { slug, name },
      update: {},
    });
    tagCache.set(slug, tag.id);
    return tag.id;
  }

  for (const appDef of APPS) {
    const slug = slugify(appDef.name);
    const createdDaysAgo = randInt(1, 120);
    const createdAt = new Date(Date.now() - createdDaysAgo * 86400_000);
    const app = await prisma.app.create({
      data: {
        slug,
        name: appDef.name,
        tagline: appDef.tagline,
        description: `${appDef.name} — ${appDef.tagline}. A leading ${appDef.category} application in the Solana ecosystem, curated and ranked by the AppMap community.`,
        url: `https://${slug}.example.com`,
        category: appDef.category,
        chain: "solana",
        status: "approved",
        submittedBy: pick(users).id,
        createdAt,
      },
    });

    // Tags + app-tags + stakes.
    let stakeTotalForApp = 0;
    for (const tagName of appDef.tags) {
      const tid = await tagId(tagName);
      const appTag = await prisma.appTag.create({
        data: {
          appId: app.id,
          tagId: tid,
          suggestedBy: pick(users).id,
          createdAt,
        },
      });
      // A few stakers per tag.
      let appTagStake = 0;
      const numStakers = randInt(0, 3);
      for (let s = 0; s < numStakers; s++) {
        const amount = randInt(50, 2000);
        await prisma.stake.create({
          data: {
            appTagId: appTag.id,
            userId: pick(users).id,
            amount,
            active: true,
            createdAt,
          },
        });
        appTagStake += amount;
      }
      if (appTagStake > 0) {
        await prisma.appTag.update({
          where: { id: appTag.id },
          data: { stakeTotal: appTagStake },
        });
      }
      stakeTotalForApp += appTagStake;
    }

    // Votes.
    let voteWeight = 0;
    const numVotes = randInt(2, 8);
    for (let v = 0; v < numVotes; v++) {
      const amount = randInt(10, 500);
      await prisma.vote.create({
        data: { appId: app.id, userId: pick(users).id, amount, createdAt },
      });
      voteWeight += amount;
    }

    // Page views + ad impressions.
    const numViews = randInt(20, 400);
    for (let p = 0; p < numViews; p++) {
      const viewedAt = new Date(
        createdAt.getTime() + rand() * (Date.now() - createdAt.getTime()),
      );
      const pv = await prisma.pageView.create({
        data: {
          appId: app.id,
          visitorId: `seed-visitor-${randInt(1, 60)}`,
          sessionId: `seed-session-${randInt(1, 200)}`,
          path: `/app/${slug}`,
          country: pick(["US", "GB", "DE", "IN", "BR", "SG"]),
          createdAt: viewedAt,
        },
      });
      // ~70% of views show an ad.
      if (rand() < 0.7) {
        const ad = pick(ads);
        await prisma.adImpression.create({
          data: {
            adId: ad.id,
            appId: app.id,
            pageViewId: pv.id,
            revenue: ad.cpm / 1000,
            clicked: rand() < 0.05,
            createdAt: viewedAt,
          },
        });
      }
    }

    // Cached aggregates + rank score.
    const rankScore = computeRankScore({
      voteWeight,
      stakeTotal: stakeTotalForApp,
      viewCount: numViews,
      ageDays: ageInDays(createdAt),
    });
    await prisma.app.update({
      where: { id: app.id },
      data: {
        voteWeight,
        voteCount: numVotes,
        stakeTotal: stakeTotalForApp,
        viewCount: numViews,
        rankScore,
      },
    });
    console.log(`  · ${appDef.name} (rank ${rankScore.toFixed(2)})`);
  }

  const counts = {
    users: await prisma.user.count(),
    apps: await prisma.app.count(),
    tags: await prisma.tag.count(),
    votes: await prisma.vote.count(),
    stakes: await prisma.stake.count(),
    views: await prisma.pageView.count(),
    impressions: await prisma.adImpression.count(),
  };
  console.log("✅ Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
