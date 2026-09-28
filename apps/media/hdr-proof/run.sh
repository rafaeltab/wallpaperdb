#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker build --platform linux/amd64 -t wallpaperdb-hdr-proof:local .
docker run --rm --platform linux/amd64 --network none --user "$(id -u):$(id -g)" \
  -v "$(pwd):/proof" -w /proof wallpaperdb-hdr-proof:local python3 suite.py "$@"
