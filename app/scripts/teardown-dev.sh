#!/usr/bin/env bash
# Winds down everything scripts/setup-dev.sh starts: the local
# solana-test-validator and the local Postgres instance (see
# scripts/ensure-postgres.sh). Safe to run even if some/none are up.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT_DIR="$(cd .. && pwd)"

LEDGER_DIR="$ROOT_DIR/test-ledger"
RPC_PORT=8899

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

log "Stopping solana-test-validator"
VALIDATOR_PID=""
if [ -f "$LEDGER_DIR.pid" ]; then
  VALIDATOR_PID="$(cat "$LEDGER_DIR.pid")"
fi
if [ -n "$VALIDATOR_PID" ] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
  kill "$VALIDATOR_PID"
  echo "  stopped (pid $VALIDATOR_PID)"
elif lsof -ti ":$RPC_PORT" >/dev/null 2>&1; then
  lsof -ti ":$RPC_PORT" | xargs kill
  echo "  stopped (found on port $RPC_PORT)"
else
  echo "  not running"
fi
rm -f "$LEDGER_DIR.pid"

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
