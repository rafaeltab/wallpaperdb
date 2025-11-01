#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "Stopping WallpaperDB infrastructure..."

cd "$INFRA_DIR"
docker compose down

echo "Infrastructure stopped successfully!"
