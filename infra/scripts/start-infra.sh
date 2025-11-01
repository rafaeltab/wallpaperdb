#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting WallpaperDB infrastructure..."

# Check if .env file exists, if not copy from .env.example
if [ ! -f "$INFRA_DIR/.env" ]; then
    echo "Creating .env file from .env.example..."
    cp "$INFRA_DIR/.env.example" "$INFRA_DIR/.env"
fi

# Start all services
cd "$INFRA_DIR"
docker compose up -d

echo ""
echo "Infrastructure started successfully!"
echo ""
echo "Service endpoints:"
echo "  PostgreSQL:             localhost:5432"
echo "  MinIO API:              http://localhost:9000"
echo "  MinIO Console:          http://localhost:9001"
echo "  OpenSearch:             http://localhost:9200"
echo "  OpenSearch Dashboards:  http://localhost:5601"
echo "  NATS:                   nats://localhost:4222"
echo "  NATS Monitoring:        http://localhost:8222"
echo "  Grafana (LGTM):         http://localhost:3000"
echo "  OTLP gRPC:              http://localhost:4317"
echo "  OTLP HTTP:              http://localhost:4318"
echo ""
echo "The LGTM stack includes Loki, Grafana, Tempo, and Mimir (Prometheus-compatible)"
echo ""
echo "Use './scripts/logs.sh' to view logs"
echo "Use './scripts/stop-infra.sh' to stop all services"
