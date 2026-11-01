#!/bin/sh
set -eu
mkdir -p .mise/boat
verify() {
  mise exec -- python scripts/boat-artifact.py "$1"
}
if [ -e .mise/boat/boat ] || [ -L .mise/boat/boat ]; then
  verify .mise/boat/boat
else
  retained="$HOME/.local/state/wallpaperdb-boat/557/tools/boat-1.0.85-linux-x64"
  # Unique staging preserves previous rejected downloads and unrelated cache.
  staged=$(mktemp .mise/boat/boat.XXXXXXXX.download)
  trap 'printf "Boat candidate retained at %s\n" "$staged" >&2' 0
  if [ -e "$retained" ] || [ -L "$retained" ]; then
    verify "$retained"
    cp -- "$retained" "$staged"
  else
    curl -fsSL 'https://boat.dev/api/boat/cli/download?platform=linux-x64&channel=prod' -o "$staged"
  fi
  verify "$staged"
  chmod 700 "$staged"
  mv -fT -- "$staged" .mise/boat/boat
  trap - 0
fi
mise exec -- .mise/boat/boat --no-update --version
