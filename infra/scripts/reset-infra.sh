#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "WARNING: This will delete all data in the infrastructure!"
read -p "Are you sure you want to continue? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Reset cancelled."
    exit 1
fi

echo "Stopping and removing all containers and volumes..."

cd "$INFRA_DIR"
docker compose down -v

echo ""
echo "Infrastructure reset complete!"
echo "Run './scripts/start-infra.sh' to start fresh infrastructure."
