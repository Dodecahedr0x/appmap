#!/usr/bin/env bash
# Winds down everything scripts/setup-dev.sh starts: the local surfpool
# Surfnet and the local Postgres instance (see scripts/ensure-postgres.sh).
# Safe to run even if some/none are up.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT_DIR="$(cd .. && pwd)"

SURFPOOL_PID_FILE="$ROOT_DIR/.surfpool/surfpool.pid"
RPC_PORT=8899

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

log "Stopping surfpool"
SURFPOOL_PID=""
if [ -f "$SURFPOOL_PID_FILE" ]; then
  SURFPOOL_PID="$(cat "$SURFPOOL_PID_FILE")"
fi
if [ -n "$SURFPOOL_PID" ] && kill -0 "$SURFPOOL_PID" 2>/dev/null; then
  kill "$SURFPOOL_PID"
  echo "  stopped (pid $SURFPOOL_PID)"
elif lsof -ti ":$RPC_PORT" >/dev/null 2>&1; then
  lsof -ti ":$RPC_PORT" | xargs kill
  echo "  stopped (found on port $RPC_PORT)"
else
  echo "  not running"
fi
rm -f "$SURFPOOL_PID_FILE"

log "Stopping local Postgres (postgresql@15)"
if ! command -v brew >/dev/null 2>&1 || ! brew list --formula postgresql@15 >/dev/null 2>&1; then
  echo "  not managed by Homebrew, skipping"
elif brew services list 2>/dev/null | grep -q '^postgresql@15 *started'; then
  brew services stop postgresql@15 >/dev/null
  echo "  stopped"
else
  echo "  not running"
fi

log "Done"
