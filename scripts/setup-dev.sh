#!/usr/bin/env bash
# Full local dev environment setup: installs deps, builds the Anchor program,
# starts a local validator, deploys the program, and seeds the database.
# See README.md "Getting started" for the manual, step-by-step version.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

LEDGER_DIR="test-ledger"
VALIDATOR_LOG="$LEDGER_DIR.log"
RPC_PORT=8899

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

for bin in anchor solana; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' not found on PATH. Install the Solana/Anchor toolchain first:" >&2
    echo "  https://www.anchor-lang.com/docs/installation" >&2
    exit 1
  fi
done

log "Installing npm dependencies"
npm install

if [ ! -f .env ]; then
  log "Creating .env from .env.example"
  cp .env.example .env
else
  log ".env already exists, leaving it untouched"
fi

BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! anchor build 2>&1 | tee "$BUILD_LOG"; then
  if grep -q "Program ID mismatch" "$BUILD_LOG"; then
    log "Program ID mismatch (target/ is gitignored, so a fresh keypair was generated) — syncing keys"
    anchor keys sync
    anchor build
  else
    exit 1
  fi
fi

PROGRAM_ID="$(solana-keygen pubkey target/deploy/appmap-keypair.json)"
if grep -q '^NEXT_PUBLIC_APPMAP_PROGRAM_ID=' .env; then
  sed -i.bak "s|^NEXT_PUBLIC_APPMAP_PROGRAM_ID=.*|NEXT_PUBLIC_APPMAP_PROGRAM_ID=\"$PROGRAM_ID\"|" .env
  rm -f .env.bak
fi

if lsof -i ":$RPC_PORT" >/dev/null 2>&1; then
  log "solana-test-validator already running on port $RPC_PORT, reusing it"
else
  log "Starting solana-test-validator in the background (log: $VALIDATOR_LOG)"
  solana-test-validator --ledger "$LEDGER_DIR" --reset >"$VALIDATOR_LOG" 2>&1 &
  VALIDATOR_PID=$!
  echo "$VALIDATOR_PID" > "$LEDGER_DIR.pid"

  log "Waiting for the validator to accept RPC connections"
  for _ in $(seq 1 60); do
    if solana cluster-version --url "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! solana cluster-version --url "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
    echo "error: validator did not come up in time, check $VALIDATOR_LOG" >&2
    exit 1
  fi
fi

log "Deploying the Anchor program to localnet"
anchor deploy --provider.cluster localnet

log "Resetting and seeding the database"
npm run db:reset

log "Done"
cat <<EOF

Local dev environment is ready:
  - solana-test-validator running on 127.0.0.1:$RPC_PORT (log: $VALIDATOR_LOG)
  - appmap program deployed to localnet
  - database reset and seeded

Next steps:
  - Run 'npm run dev' to start the app (http://localhost:3000)
  - Set NEXT_PUBLIC_VOTE_TOKEN_MINT in .env to a real SPL mint to exercise
    on-chain voting/staking (leave blank to stay in simulation mode)
  - Stop the validator with: kill \$(cat $LEDGER_DIR.pid)
EOF
