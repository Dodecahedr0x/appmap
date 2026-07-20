-- Caps XP for a given (user, kind) at once per UTC calendar day, replacing
-- the old once-per-target-ever cap from 006_xp_levels.sql. See
-- indexer/src/handlers/xp.rs's record_event/award.

-- Nullable at first so existing rows don't need a value up front; backfilled
-- from each row's own "createdAt" below, then locked down to NOT NULL —
-- can't combine ADD COLUMN with a backfill-dependent value in one statement.
ALTER TABLE "XpEvent" ADD COLUMN IF NOT EXISTS "awardDate" DATE;
UPDATE "XpEvent" SET "awardDate" = ("createdAt" AT TIME ZONE 'UTC')::date WHERE "awardDate" IS NULL;
ALTER TABLE "XpEvent" ALTER COLUMN "awardDate" SET NOT NULL;

-- Superseded by the index below: a user could earn "vote" XP for the same
-- app on two different days once this ships, which the old per-target index
-- would have permanently blocked after the first time.
DROP INDEX IF EXISTS "XpEvent_userId_kind_targetId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "XpEvent_userId_kind_awardDate_key"
    ON "XpEvent" ("userId", "kind", "awardDate");
