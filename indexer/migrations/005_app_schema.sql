-- The product's data model (crowd-sourced app listings, votes, tag stakes,
-- ad revenue) — GENERATED from app/prisma/schema.prisma via:
--   npx prisma migrate diff --from-empty --to-schema-datamodel app/prisma/schema.prisma --script
-- (then hand-adjusted to add IF NOT EXISTS, matching this directory's house
-- style — including each AddForeignKey, wrapped in a DO block that swallows
-- duplicate_object, since Postgres has no ADD CONSTRAINT IF NOT EXISTS for
-- ALTER TABLE. Without that, replaying this migration against a database
-- that already has these objects but isn't recorded as having applied
-- migration 5 in _sqlx_migrations — e.g. an interrupted prior `dev:all` run —
-- fails on the first foreign key with "constraint ... already exists",
-- even though every CREATE TABLE/INDEX above it skips cleanly).
-- Schema ownership lives HERE, not in app/: the indexer applies
-- every file in this directory via `sqlx::migrate!()` at startup
-- (src/db.rs), and app/ no longer runs `prisma db push`/`prisma migrate` —
-- see AGENTS.md. app/prisma/schema.prisma still exists purely as the
-- Prisma Client codegen input (`prisma generate`, no DDL-applying command),
-- so its shape MUST stay in sync with this file by hand; regenerate this
-- migration's CREATE-TABLE bodies with the command above whenever the
-- Prisma schema changes and hand-merge, rather than editing column lists
-- independently in both places.
--
-- Population is likewise the indexer's job, not a seed script: `App`/`Tag`/
-- `AppTag` rows are created by indexer/src/processors/instruction.rs when it
-- observes confirmed `init_app`/`suggest_tag` instructions on-chain (backfilled
-- at startup, kept live via the instruction crawler) — see that file's doc
-- comment. `User` rows are upserted by the same path, keyed by the
-- transaction's fee payer. Everything else (votes/stakes recorded through
-- the app's existing on-chain-tx-then-API-record flow, ads, revenue epochs,
-- page views) keeps its existing app-owned write path — only schema
-- ownership and app-creation moved here, not the whole product.

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "handle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "App" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "iconUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "chain" TEXT NOT NULL DEFAULT 'solana',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "voteWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stakeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "rankScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppTag" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "suggestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stakeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AppTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Vote" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "txSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Stake" (
    "id" TEXT NOT NULL,
    "appTagId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "txSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Stake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PageView" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "country" TEXT,
    "userAgent" TEXT,
    "revenueEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ad" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "targetUrl" TEXT NOT NULL,
    "cpm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdImpression" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "pageViewId" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "epochId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RevenueEpoch" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEpoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RevenueClaim" (
    "id" TEXT NOT NULL,
    "epochId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "txSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "RevenueClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppStatsSnapshot" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "voteWeight" DOUBLE PRECISION NOT NULL,
    "stakeTotal" DOUBLE PRECISION NOT NULL,
    "viewCount" INTEGER NOT NULL,
    "rankScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_wallet_idx" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "App_slug_key" ON "App"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "App_category_idx" ON "App"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "App_status_idx" ON "App"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "App_rankScore_idx" ON "App"("rankScore");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tag_slug_idx" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppTag_appId_idx" ON "AppTag"("appId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppTag_tagId_idx" ON "AppTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AppTag_appId_tagId_key" ON "AppTag"("appId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Vote_txSig_key" ON "Vote"("txSig");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Vote_appId_idx" ON "Vote"("appId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Vote_userId_idx" ON "Vote"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Vote_active_idx" ON "Vote"("active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Stake_txSig_key" ON "Stake"("txSig");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stake_appTagId_idx" ON "Stake"("appTagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stake_userId_idx" ON "Stake"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Stake_active_idx" ON "Stake"("active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageView_appId_idx" ON "PageView"("appId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageView_visitorId_idx" ON "PageView"("visitorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageView_createdAt_idx" ON "PageView"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_active_idx" ON "Ad"("active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdImpression_appId_idx" ON "AdImpression"("appId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdImpression_epochId_idx" ON "AdImpression"("epochId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdImpression_createdAt_idx" ON "AdImpression"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RevenueEpoch_appId_idx" ON "RevenueEpoch"("appId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RevenueEpoch_distributed_idx" ON "RevenueEpoch"("distributed");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RevenueClaim_userId_idx" ON "RevenueClaim"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RevenueClaim_epochId_userId_key" ON "RevenueClaim"("epochId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppStatsSnapshot_appId_idx" ON "AppStatsSnapshot"("appId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AppStatsSnapshot_appId_date_key" ON "AppStatsSnapshot"("appId", "date");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "App" ADD CONSTRAINT "App_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AppTag" ADD CONSTRAINT "AppTag_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AppTag" ADD CONSTRAINT "AppTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AppTag" ADD CONSTRAINT "AppTag_suggestedBy_fkey" FOREIGN KEY ("suggestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Vote" ADD CONSTRAINT "Vote_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Stake" ADD CONSTRAINT "Stake_appTagId_fkey" FOREIGN KEY ("appTagId") REFERENCES "AppTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Stake" ADD CONSTRAINT "Stake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PageView" ADD CONSTRAINT "PageView_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_pageViewId_fkey" FOREIGN KEY ("pageViewId") REFERENCES "PageView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "RevenueEpoch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "RevenueEpoch" ADD CONSTRAINT "RevenueEpoch_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "RevenueClaim" ADD CONSTRAINT "RevenueClaim_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "RevenueEpoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "RevenueClaim" ADD CONSTRAINT "RevenueClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AppStatsSnapshot" ADD CONSTRAINT "AppStatsSnapshot_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

