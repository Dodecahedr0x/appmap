-- XP & Levels: cosmetic gamification layered on existing actions. See
-- docs/plans/2026-07-20-gamification-xp-levels-design.md. Level/title are
-- pure functions of `xp` (indexer/src/handlers/xp.rs), not stored here.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastXpDate" DATE;

CREATE TABLE IF NOT EXISTS "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per (user, kind, target): this is what makes vote/stake XP
-- "first time per target only" (design doc Section 2), and it makes
-- reprocessing (backfill re-run, startup) idempotent for submit_app/
-- suggest_tag too. daily_bonus rows have targetId = NULL, and Postgres
-- never treats two NULLs as equal in a unique index, so multiple
-- daily_bonus rows per user (one per day) are unaffected by this index.
CREATE UNIQUE INDEX IF NOT EXISTS "XpEvent_userId_kind_targetId_key"
    ON "XpEvent" ("userId", "kind", "targetId");

CREATE INDEX IF NOT EXISTS "XpEvent_userId_idx" ON "XpEvent" ("userId");
