#!/usr/bin/env bash
# Full local dev environment setup: installs deps, builds the Anchor program,
# starts a local Surfnet (surfpool, forking mainnet — see surfpool.run) with
# SOL/USDC airdropped to the dev keypair, deploys the program, launches NEB
# (mints its supply and seeds the NEB/USDC DLMM pool — see scripts/launch-neb/),
# starts the indexer (the app's only path to Solana RPC — see
# indexer/README.md and src/lib/indexerClient.ts), and seeds the database.
# See README.md "Getting started" for the manual, step-by-step version.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP_DIR="$(pwd)"
ROOT_DIR="$(cd "$APP_DIR/.." && pwd)"
INDEXER_DIR="$ROOT_DIR/indexer"

RPC_PORT=8899
INDEXER_API_PORT=8090
SURFPOOL_LOG_DIR="$ROOT_DIR/.surfpool/logs"
SURFPOOL_PID_FILE="$ROOT_DIR/.surfpool/surfpool.pid"
INDEXER_LOG="$ROOT_DIR/.surfpool/indexer.log"
INDEXER_PID_FILE="$ROOT_DIR/.surfpool/indexer.pid"
DEV_KEYPAIR="$HOME/.config/solana/id.json"
# Real mainnet USDC — surfpool forks mainnet by default, so this (and every
# other mainnet program/account: DLMM, Metaplex Token Metadata, ...) is
# fetched on demand with no manual account-cloning needed.
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
TOKEN_PROGRAM_ID="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

for bin in anchor solana surfpool cargo; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' not found on PATH." >&2
    if [ "$bin" = "surfpool" ]; then
      echo "  Install: curl -sL https://run.surfpool.run/ | bash" >&2
    elif [ "$bin" = "cargo" ]; then
      echo "  Install Rust first: https://www.rust-lang.org/tools/install" >&2
    else
      echo "  Install the Solana/Anchor toolchain first: https://www.anchor-lang.com/docs/installation" >&2
    fi
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

if [ ! -f "$DEV_KEYPAIR" ]; then
  log "No keypair at $DEV_KEYPAIR — generating one"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$DEV_KEYPAIR"
fi

BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! (cd "$ROOT_DIR" && anchor build) 2>&1 | tee "$BUILD_LOG"; then
  if grep -q "Program ID mismatch" "$BUILD_LOG"; then
    log "Program ID mismatch (target/ is gitignored, so a fresh keypair was generated) — syncing keys"
    (cd "$ROOT_DIR" && anchor keys sync && anchor build)
  else
    exit 1
  fi
fi

PROGRAM_ID="$(solana-keygen pubkey "$ROOT_DIR/target/deploy/nebulous_world-keypair.json")"
if grep -q '^NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID=' .env; then
  sed -i.bak "s|^NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID=.*|NEXT_PUBLIC_NEBULOUS_WORLD_PROGRAM_ID=\"$PROGRAM_ID\"|" .env
  rm -f .env.bak
fi

if lsof -i ":$RPC_PORT" >/dev/null 2>&1; then
  log "A Surfnet (or something else) is already running on port $RPC_PORT, reusing it"
else
  log "Starting surfpool in the background, forking mainnet (logs: $SURFPOOL_LOG_DIR)"
  mkdir -p "$(dirname "$SURFPOOL_PID_FILE")"
  surfpool start \
    --network mainnet \
    --no-tui --no-studio --no-deploy \
    --airdrop-keypair-path "$DEV_KEYPAIR" \
    --log-path "$SURFPOOL_LOG_DIR" \
    >"$SURFPOOL_LOG_DIR.out" 2>&1 &
  echo "$!" > "$SURFPOOL_PID_FILE"

  log "Waiting for the Surfnet to accept RPC connections"
  for _ in $(seq 1 60); do
    if solana cluster-version --url "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! solana cluster-version --url "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
    echo "error: Surfnet did not come up in time, check $SURFPOOL_LOG_DIR.out" >&2
    exit 1
  fi
fi

log "Airdropping USDC to the dev keypair"
DEV_PUBKEY="$(solana-keygen pubkey "$DEV_KEYPAIR")"
AIRDROP_RESPONSE="$(curl -s "http://127.0.0.1:$RPC_PORT" -X POST -H "Content-Type: application/json" -d "$(
  cat <<JSON
{"jsonrpc":"2.0","id":1,"method":"surfnet_setTokenAccount","params":["$DEV_PUBKEY","$USDC_MINT",{"amount":1000000000},"$TOKEN_PROGRAM_ID"]}
JSON
)")"
if echo "$AIRDROP_RESPONSE" | grep -q '"error"'; then
  echo "error: USDC airdrop failed: $AIRDROP_RESPONSE" >&2
  exit 1
fi
echo "  1000 USDC -> $DEV_PUBKEY"

log "Deploying the Anchor program to localnet"
(cd "$ROOT_DIR" && anchor deploy --provider.cluster localnet)

NEB_CONFIG="scripts/launch-neb/launch-neb.config.json"
POOL_ADDR="$(grep -E '^NEXT_PUBLIC_NEB_DLMM_POOL="[^"]+"' .env | sed -E 's/^[^"]*"([^"]+)".*/\1/' || true)"
# .env persists across restarts, but surfpool's forked state is in-memory by
# default (no --db) — a torn-down-and-restarted Surfnet has none of the
# previous run's local writes, even though .env still points at them. Check
# the pool account actually exists on THIS Surfnet before trusting .env.
POOL_EXISTS=""
if [ -n "$POOL_ADDR" ]; then
  POOL_EXISTS="$(curl -s "http://127.0.0.1:$RPC_PORT" -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$POOL_ADDR\"]}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if d.get("result",{}).get("value") else "")' 2>/dev/null || true)"
fi
if [ -n "$POOL_EXISTS" ]; then
  log "NEB already launched and its pool ($POOL_ADDR) exists on this Surfnet, skipping"
else
  log "Launching NEB: minting its supply and seeding the NEB/USDC DLMM pool"
  if [ ! -f "$NEB_CONFIG" ]; then
    cat > "$NEB_CONFIG" <<JSON
{
  "rpcUrl": "http://127.0.0.1:$RPC_PORT",
  "cluster": "mainnet-beta",
  "keypairFilePath": "$DEV_KEYPAIR",
  "quoteMint": "$USDC_MINT",
  "dryRun": false,
  "token": {
    "name": "Nebula",
    "symbol": "NEB",
    "decimals": 6,
    "totalSupply": 1000000000,
    "uri": "https://example.com/neb-metadata.json",
    "revokeMintAuthority": true,
    "isMutable": true
  },
  "pool": {
    "binStep": 100,
    "feeBps": 100,
    "initialPrice": 0.001,
    "priceRounding": "up",
    "activationType": "timestamp",
    "activationPoint": null,
    "creatorPoolOnOffControl": false
  }
}
JSON
  fi

  LAUNCH_LOG="$(mktemp)"
  npx tsx scripts/launch-neb/index.ts --config="$NEB_CONFIG" | tee "$LAUNCH_LOG"
  # The script's own final "Set these in app/.env:" lines are already valid
  # KEY="VALUE" assignments — pull them out and apply the same way the
  # program id gets synced above.
  while IFS= read -r line; do
    key="${line%%=*}"
    if grep -q "^${key}=" .env; then
      sed -i.bak "s|^${key}=.*|${line}|" .env
      rm -f .env.bak
    else
      echo "$line" >> .env
    fi
  done < <(grep -oE 'NEXT_PUBLIC_(VOTE_TOKEN_MINT|NEB_DLMM_POOL)="[^"]*"' "$LAUNCH_LOG")
  rm -f "$LAUNCH_LOG"
fi

# `Config` (the program's one global singleton) only ever gets created by a
# one-time `initialize` call signed by the program's upgrade authority —
# nothing else in this script does that, so every vote/stake instruction
# would fail with AccountNotInitialized on a freshly deployed program until
# this runs. Idempotent (no-ops if already initialized), so safe on a
# reused Surfnet too. Must run after the NEB launch above — it needs
# NEXT_PUBLIC_VOTE_TOKEN_MINT in .env.
log "Ensuring the program's Config is initialized"
npm run ensure:config

log "Installing indexer/dlmm-bridge dependencies"
(cd "$INDEXER_DIR/dlmm-bridge" && npm install)

log "Building the indexer"
(cd "$INDEXER_DIR" && cargo build)

# The indexer connects to Postgres eagerly at startup (indexer/src/db.rs)
# and exits immediately if that fails — it doesn't retry/wait. Postgres
# itself is normally provisioned by `db:reset` below via
# scripts/ensure-postgres.sh, but that runs AFTER the indexer starts, so on
# a machine where Postgres isn't already running (e.g. right after
# teardown-dev.sh's `brew services stop postgresql@15`, which every prior
# `dev:all` session's Ctrl-C triggers) the indexer's PgPool times out
# connecting, the process exits before ever binding its HTTP port, and the
# "did not come up in time" check below fails. Call the same idempotent
# provisioning script here, first, so Postgres is guaranteed reachable
# before the indexer ever tries to connect.
log "Ensuring local Postgres is up (the indexer needs it at startup)"
bash scripts/ensure-postgres.sh

if lsof -i ":$INDEXER_API_PORT" >/dev/null 2>&1; then
  log "The indexer (or something else) is already running on port $INDEXER_API_PORT, reusing it"
else
  log "Starting the indexer in the background (logs: $INDEXER_LOG)"
  # dotenvy (indexer/src/config.rs) loads this same app/.env automatically —
  # by this point it has the deployed program id, NEB mint, and pool address
  # this run just wrote into it, so a single startup here picks up all of
  # them (unlike starting the indexer earlier, before those existed).
  (cd "$INDEXER_DIR" && RUST_LOG=info nohup cargo run >"$INDEXER_LOG" 2>&1 &)
  sleep 1
  # cargo run's own child process (the `indexer` binary) is what's actually
  # listening — grab its pid by port rather than cargo's, so teardown-dev.sh
  # can kill the right process even if cargo's wrapper has already exited.
  for _ in $(seq 1 60); do
    INDEXER_PID="$(lsof -ti ":$INDEXER_API_PORT" 2>/dev/null || true)"
    [ -n "$INDEXER_PID" ] && break
    sleep 1
  done
  if [ -z "${INDEXER_PID:-}" ]; then
    echo "error: indexer did not come up in time, check $INDEXER_LOG" >&2
    exit 1
  fi
  echo "$INDEXER_PID" > "$INDEXER_PID_FILE"
fi

log "Resetting and seeding the database"
npm run db:reset

log "Done"
cat <<EOF

Local dev environment is ready:
  - surfpool (mainnet fork) running on 127.0.0.1:$RPC_PORT (logs: $SURFPOOL_LOG_DIR)
  - dev keypair funded with SOL + 1000 USDC
  - nebulous_world program deployed to localnet
  - NEB minted and its DLMM pool created (or reused — see .env)
  - indexer running on 127.0.0.1:$INDEXER_API_PORT (logs: $INDEXER_LOG) — the
    app talks to this instead of Solana RPC directly, see indexer/README.md
  - database reset and seeded

Next steps:
  - Run 'npm run dev' to start the app (http://localhost:3000)
  - Run 'npm run db:seed:onchain' to buy real NEB from the pool and place
    real on-chain votes/stakes across the seeded apps/tags (prisma/seed.ts's
    votes/stakes are fake DB rows only, not real transactions)
  - Run 'npm run teardown:dev' to stop surfpool, the indexer, and local Postgres
EOF
