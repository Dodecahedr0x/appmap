#!/usr/bin/env bash
# Ensures a local Postgres role + database exist so `prisma db push` works
# out of the box, mirroring how setup-dev.sh auto-starts surfpool.
# No-op when DATABASE_URL points at a non-local host (e.g. a managed
# Render/Neon database) — nothing to provision there.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DB_URL="${1:-}"
if [ -z "$DB_URL" ]; then
  if [ -f .env ]; then
    DB_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"')"
  fi
  DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:5432/nebulous_world_dev}"
fi

read -r PROTOCOL HOST PORT PGUSER PGPASS DBNAME <<EOF
$(node -e '
  const u = new URL(process.argv[1]);
  console.log([u.protocol, u.hostname, u.port || "5432", decodeURIComponent(u.username), decodeURIComponent(u.password), u.pathname.slice(1)].join(" "));
' "$DB_URL")
EOF

if [ "$PROTOCOL" != "postgresql:" ] && [ "$PROTOCOL" != "postgres:" ]; then
  echo "error: DATABASE_URL is not a Postgres connection string: $DB_URL" >&2
  echo "       (this app's Prisma schema requires postgresql://... — see .env.example)" >&2
  exit 1
fi

if [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew not found. Install Postgres yourself and create '$DBNAME', or set DATABASE_URL to an existing instance." >&2
  exit 1
fi

if ! brew list --formula postgresql@15 >/dev/null 2>&1; then
  echo "==> Installing postgresql@15"
  brew install postgresql@15 >/dev/null
fi
export PATH="$(brew --prefix postgresql@15)/bin:$PATH"

if ! pg_isready -h "$HOST" -p "$PORT" >/dev/null 2>&1; then
  echo "==> Starting postgresql@15"
  brew services start postgresql@15 >/dev/null
  for _ in $(seq 1 30); do
    pg_isready -h "$HOST" -p "$PORT" >/dev/null 2>&1 && break
    sleep 1
  done
fi

SUPERUSER="$(whoami)"
if ! psql -h "$HOST" -p "$PORT" -U "$SUPERUSER" -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$PGUSER'" | grep -q 1; then
  echo "==> Creating role '$PGUSER'"
  psql -h "$HOST" -p "$PORT" -U "$SUPERUSER" -d postgres -c \
    "CREATE ROLE \"$PGUSER\" WITH LOGIN SUPERUSER PASSWORD '$PGPASS';"
fi

if ! psql -h "$HOST" -p "$PORT" -U "$SUPERUSER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1; then
  echo "==> Creating database '$DBNAME'"
  psql -h "$HOST" -p "$PORT" -U "$SUPERUSER" -d postgres -c \
    "CREATE DATABASE \"$DBNAME\" OWNER \"$PGUSER\";"
fi
