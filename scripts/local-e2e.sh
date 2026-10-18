#!/usr/bin/env bash
set -eu

exec node --experimental-strip-types scripts/local-e2e.mjs "$@"
