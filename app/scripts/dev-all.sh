#!/usr/bin/env bash
# One-command local dev: run the full environment setup (scripts/setup-dev.sh
# — surfpool, program deploy, NEB launch, the indexer, which applies its own
# database schema on startup), then start the Next.js dev server. Ctrl-C (or
# any exit) tears everything back
# down via scripts/teardown-dev.sh, so you don't have to remember a
# separate command.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

cleanup() {
  echo
  bash scripts/teardown-dev.sh
}
trap cleanup EXIT
trap exit INT TERM

bash scripts/setup-dev.sh
npm run dev
