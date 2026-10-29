#!/bin/sh
set -eu
if ! command -v mise >/dev/null 2>&1; then
  echo 'mise is required. See CONTRIBUTING.md for setup, then run make install.' >&2
  exit 127
fi
export MISE_AUTO_INSTALL=false
export MISE_LOCKED=true
mise exec -- node scripts/toolchain.mjs --pins
if [ -f .boat/cache.json ]; then
  exec mise exec -- node scripts/boat-shell.mjs "$@"
fi
exec mise exec -- sh "$@"
