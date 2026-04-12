#!/bin/bash
# check-infra.sh — Verify that the infrastructure postgres container is running.
# Called by `make dev` before starting app containers.
# Exits 0 if infra is running, 1 otherwise.
set -e

# shellcheck source=../.worktree
# Load .worktree if COMPOSE_PROJECT_NAME is not already set (e.g., when run standalone).
# When called from the Makefile, COMPOSE_PROJECT_NAME is already exported.
if [ -z "$COMPOSE_PROJECT_NAME" ]; then
    WORKTREE_FILE="$(dirname "$0")/../.worktree"
    # shellcheck disable=SC1090
    source "$WORKTREE_FILE" 2>/dev/null || {
        echo "No .worktree file found. Run pnpm install first."
        exit 1
    }
fi

docker compose -p "$COMPOSE_PROJECT_NAME" -f infra/docker-compose.yml \
    ps --status running --format '{{.Service}}' | grep -q '^postgres$'
