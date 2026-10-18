#!/usr/bin/env bash
set -eu

# Dry runs only inspect Turbo's graph. They acquire no Docker resources.
for argument in "$@"; do
  case "$argument" in
    --dry*) exec node --experimental-strip-types scripts/local-e2e.mjs "$@" ;;
  esac
done

command -v flock >/dev/null || { echo 'Local E2E requires flock (util-linux) for shared Docker host coordination.' >&2; exit 1; }
lock_file=${E2E_LOCK_FILE:-/tmp/wallpaperdb-perf-validation.lock}
lock_timeout=${E2E_LOCK_TIMEOUT:-900}
case "$lock_timeout" in ''|*[!0-9]*) echo 'E2E_LOCK_TIMEOUT must be a positive integer in seconds.' >&2; exit 1 ;; esac
test "$lock_timeout" -gt 0 || exit 1
trap 'exit 130' INT
trap 'exit 143' TERM
exec 9>"$lock_file"
deadline=$((SECONDS + lock_timeout))
echo "Waiting for Docker host lock $lock_file (deadline ${lock_timeout}s)..."
until flock -n 9; do
  remaining=$((deadline - SECONDS))
  if test "$remaining" -le 0; then
    echo "Docker host lock timed out. Another validation owns $lock_file; retry after it finishes." >&2
    exit 75
  fi
  echo "Docker host lock busy; ${remaining}s remaining."
  if test "$remaining" -gt 5; then remaining=5; fi
  if flock -w "$remaining" 9; then break; fi
done
echo 'Docker host lock acquired.'
# Keep fd 9 open until Node has completed every required cleanup.
exec node --experimental-strip-types scripts/local-e2e.mjs "$@"
