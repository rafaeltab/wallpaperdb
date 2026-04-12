#!/bin/sh
# Shared entrypoint for all WallpaperDB development containers.
#
# On each container start:
#   1. Re-runs pnpm install if pnpm-lock.yaml has changed since the image was built.
#   2. Optionally runs database migrations (set RUN_DB_MIGRATE=true for ingestor/media).
#   3. Hands off to CMD.

set -e

LOCKFILE=/app/pnpm-lock.yaml
HASH_FILE=/app/.pnpm-lockfile-hash

# ── Lockfile change detection ────────────────────────────────────────────────
# The image bakes in pnpm install and stores the lockfile hash at build time.
# If docker compose watch syncs a new pnpm-lock.yaml into the container, this
# detects the change and re-runs pnpm install before starting the app.
if [ -f "$LOCKFILE" ]; then
    current_hash=$(sha256sum "$LOCKFILE" | cut -d' ' -f1)
    stored_hash=""
    if [ -f "$HASH_FILE" ]; then
        stored_hash=$(cat "$HASH_FILE")
    fi

    if [ "$current_hash" != "$stored_hash" ]; then
        echo "[entrypoint] pnpm-lock.yaml changed — re-running pnpm install..."
        (cd /app && pnpm install --frozen-lockfile)
        echo "$current_hash" > "$HASH_FILE"
        echo "[entrypoint] pnpm install complete."
    fi
fi

# ── Database migrations ───────────────────────────────────────────────────────
# Set RUN_DB_MIGRATE=true in docker-compose.apps.yml for ingestor and media.
# Drizzle migrations are idempotent — safe to run on every container start.
if [ "${RUN_DB_MIGRATE:-false}" = "true" ]; then
    echo "[entrypoint] Running database migrations..."
    pnpm run db:migrate
    echo "[entrypoint] Migrations complete."
fi

# ── Hand off to CMD ───────────────────────────────────────────────────────────
exec "$@"
