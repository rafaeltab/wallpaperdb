#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

cd "$INFRA_DIR"

# If a service name is provided, show logs for that service
# Otherwise, show logs for all services
if [ -n "$1" ]; then
    docker compose logs -f "$1"
else
    docker compose logs -f
fi
