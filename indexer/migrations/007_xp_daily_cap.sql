-- Caps XP for a given (user, kind) at once per UTC calendar day, replacing
-- the old once-per-target-ever cap from 006_xp_levels.sql. See
-- indexer/src/handlers/xp.rs's record_event/award.

-- Nullable at first so existing rows don't need a value up front; backfilled
-- from each row's own "createdAt" below, then locked down to NOT NULL —
-- can't combine ADD COLUMN with a backfill-dependent value in one statement.
ALTER TABLE "XpEvent" ADD COLUMN IF NOT EXISTS "awardDate" DATE;
UPDATE "XpEvent" SET "awardDate" = ("createdAt" AT TIME ZONE 'UTC')::date WHERE "awardDate" IS NULL;
ALTER TABLE "XpEvent" ALTER COLUMN "awardDate" SET NOT NULL;

-- Reconcile existing rows to the new one-per-(user,kind)-per-day model
-- before enforcing it as a unique index: under the OLD per-target index
-- above, a user could earn e.g. "vote" XP for several different apps on the
-- same UTC day, each a distinct row — and each already incremented
-- User.xp via record_event's own UPDATE. Keep only the earliest such row
-- per ("userId", kind, "awardDate") — the same "oldest-first, earliest
-- wins the slot" tie-break xp.rs's own backfill() uses — and drop the
-- rest, so the CREATE UNIQUE INDEX below doesn't fail on data that was
-- perfectly valid under the constraint it's replacing.
DELETE FROM "XpEvent" e USING "XpEvent" e2
WHERE e."userId" = e2."userId"
  AND e.kind = e2.kind
  AND e."awardDate" = e2."awardDate"
  AND (e."createdAt", e.id) > (e2."createdAt", e2.id);

-- User.xp is only ever incremented in the same transaction as an XpEvent
-- insert (record_event), so it's always exactly the sum of that user's
-- surviving events — recompute it here so the deleted duplicates' amounts
-- don't leave every affected user's total permanently inflated relative to
-- what the new model would have produced.
UPDATE "User" u SET xp = COALESCE(sub.total, 0)
FROM (SELECT "userId", SUM(amount) AS total FROM "XpEvent" GROUP BY "userId") sub
WHERE u.id = sub."userId";

-- Superseded by the index below: a user could earn "vote" XP for the same
-- app on two different days once this ships, which the old per-target index
-- would have permanently blocked after the first time.
DROP INDEX IF EXISTS "XpEvent_userId_kind_targetId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "XpEvent_userId_kind_awardDate_key"
    ON "XpEvent" ("userId", "kind", "awardDate");
