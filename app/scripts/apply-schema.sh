#!/usr/bin/env bash
# Applies the indexer's SQL migrations (../indexer/migrations/*.sql — the
# single source of truth for every table, including the product schema
# mirrored from prisma/schema.prisma, see indexer/migrations/005_app_schema.sql's
# header) directly via psql, in filename order — the same files the indexer
# itself applies at startup via `sqlx::migrate!()` (indexer/src/db.rs), just
# run with a plain SQL client instead of the Rust binary so this script has
# no extra tooling dependency beyond psql (already required by
# ensure-postgres.sh). Table/index creation is `IF NOT EXISTS`, so re-running
# against an already-migrated database is safe up through those — foreign
# key constraints are not (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`),
# so a second run against the SAME database errors on those. Not tracked
# with a `_sqlx_migrations` table like the real indexer's run: this script
# is meant for a fresh throwaway database each time (ensure-postgres.sh
# creates one), not repeated runs against the same one.
#
# Schema ownership lives in the indexer now — this app no longer runs
# `prisma db push`/`prisma migrate` (see AGENTS.md). This script exists only
# because tests (`pretest`, below) need *some* way to get a throwaway test
# database into shape without running the full Rust indexer binary; it
# applies DDL only, never seeds a single row, so it isn't the "seed script"
# AGENTS.md says this repo intentionally doesn't have.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DB_URL="${1:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "error: no database URL given (pass one as \$1 or set DATABASE_URL)" >&2
  exit 1
fi

for migration in ../indexer/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done
