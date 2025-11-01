# WallpaperDB Local Infrastructure

This directory contains the local development infrastructure for WallpaperDB using Docker Compose.

## Services

- **PostgreSQL** (port 5432) - Metadata database
- **MinIO** (ports 9000, 9001) - S3-compatible object storage
- **OpenSearch** (port 9200) - Search engine
- **OpenSearch Dashboards** (port 5601) - Search visualization
- **NATS** (ports 4222, 8222) - Message queue with JetStream
- **Grafana LGTM** (ports 3000, 4317, 4318) - All-in-one observability stack
  - Loki - Log aggregation
  - Grafana - Dashboards and visualization
  - Tempo - Distributed tracing
  - Mimir - Prometheus-compatible metrics storage

## Quick Start

From the project root, run:

```bash
make infra-start
```

This will:
1. Create a `.env` file from `.env.example` if it doesn't exist
2. Start all infrastructure services
3. Initialize MinIO buckets automatically

## Available Commands

```bash
make infra-start    # Start all services
make infra-stop     # Stop all services
make infra-reset    # Reset all data (WARNING: deletes everything)
make infra-logs     # Tail logs from all services
```

You can also use turbo directly:

```bash
turbo run start --filter=@wallpaperdb/infra-local
turbo run stop --filter=@wallpaperdb/infra-local
```

## Service Endpoints

After starting the infrastructure:

- PostgreSQL: `postgresql://wallpaperdb:wallpaperdb@localhost:5432/wallpaperdb`
- MinIO Console: http://localhost:9001 (minioadmin/minioadmin)
- MinIO API: http://localhost:9000
- OpenSearch: http://localhost:9200
- OpenSearch Dashboards: http://localhost:5601
- NATS: `nats://localhost:4222`
- NATS Monitoring: http://localhost:8222
- Grafana: http://localhost:3000 (admin/admin)
- OTLP gRPC: http://localhost:4317 (for telemetry)
- OTLP HTTP: http://localhost:4318 (for telemetry)

## Configuration

Copy `.env.example` to `.env` and modify as needed. The default values work for local development.

## Volumes

All data is persisted in Docker volumes:
- `postgres-data` - PostgreSQL database
- `minio-data` - Object storage
- `opensearch-data` - Search indices
- `nats-data` - Message queue data
- `lgtm-data` - Grafana LGTM stack (metrics, logs, traces, dashboards)

## Initialization Scripts

Example initialization scripts are provided in:
- `postgres/init/` - SQL scripts run on first startup
- `opensearch/init/` - Index creation scripts
- `nats/init/` - Stream creation scripts

MinIO buckets are created automatically by the `minio-init` service.

## Observability with LGTM

The Grafana LGTM stack provides a complete observability solution:

- **Metrics**: Send metrics via OTLP to port 4317 (gRPC) or 4318 (HTTP)
- **Logs**: Send logs via OTLP to the same endpoints
- **Traces**: Send traces via OTLP to the same endpoints
- **Dashboards**: Access Grafana at http://localhost:3000

All data sources are pre-configured and ready to use in Grafana.
