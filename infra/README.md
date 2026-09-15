# WallpaperDB Local Infrastructure

This directory contains the local development infrastructure for WallpaperDB using Docker Compose.

## Services

- **PostgreSQL** (port 5432) - Metadata database
- **SeaweedFS** (S3 API on host port 8002 for worktree slot 0) - S3-compatible object storage
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
3. Initialize SeaweedFS buckets automatically

## Available Commands

```bash
make infra-start    # Start all services
make infra-stop     # Stop all services
make infra-reset    # Reset all data (WARNING: deletes everything)
make infra-logs     # Tail logs from all services
```

## Service Endpoints

After starting the infrastructure:

- PostgreSQL: `postgresql://wallpaperdb:wallpaperdb@localhost:5432/wallpaperdb`
- SeaweedFS S3 API: http://localhost:8002 (slot 0; access key and secret key: `minioadmin`)
  - Other worktrees use `8002 + 10 × slot`; check `S3_API_HOST_PORT` in `infra/.env`.
  - Applications in Docker use `http://seaweedfs:9000`. Use an S3 client for object administration; the old `/minio` console route is removed.
- OpenSearch: http://localhost:9200
- OpenSearch Dashboards: http://localhost:5601
- NATS: `nats://localhost:4222`
- NATS Monitoring: http://localhost:8222
- Grafana: http://localhost:3000 (admin/admin)
- OTLP gRPC: http://localhost:4317 (for telemetry)
- OTLP HTTP: http://localhost:4318 (for telemetry)

## Configuration

The worktree setup generates `infra/.env` from `.env.example`. The default values work for local development. Storage uses `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_API_HOST_PORT`. Legacy `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and `MINIO_API_HOST_PORT` values remain fallbacks when the corresponding S3 variable is absent. The `minio` Docker network alias remains available for existing app environments.

## Volumes

All data is persisted in Docker volumes:
- `postgres-data` - PostgreSQL database
- `seaweedfs-data` - Object storage
- `opensearch-data` - Search indices
- `nats-data` - Message queue data
- `lgtm-data` - Grafana LGTM stack (metrics, logs, traces, dashboards)

Before switching an existing environment, stop application writes and run `make infra-stop` in the old checkout. If already switched, follow the migration guide to remove the orphaned MinIO containers without removing volumes; otherwise the old service can retain the S3 port and network alias. The old `minio-data` volume is retained and is incompatible with SeaweedFS. Existing data is not copied automatically. Back up the database and objects, copy through the S3 API with metadata preservation, and verify the destination before retiring the source. See the [migration procedure](../apps/docs/content/docs/infrastructure/seaweedfs.mdx#existing-minio-data).

## Initialization Scripts

Example initialization scripts are provided in:
- `postgres/init/` - SQL scripts run on first startup
- `opensearch/init/` - Index creation scripts
- `nats/init/` - Stream creation scripts

SeaweedFS `mini` creates `wallpapers` and `example-bucket` automatically from `S3_BUCKET`. The pinned image is `chrislusf/seaweedfs:4.47`; no separate bucket initializer or MinIO client is required.

## Observability with LGTM

The Grafana LGTM stack provides a complete observability solution:

- **Metrics**: Send metrics via OTLP to port 4317 (gRPC) or 4318 (HTTP)
- **Logs**: Send logs via OTLP to the same endpoints
- **Traces**: Send traces via OTLP to the same endpoints
- **Dashboards**: Access Grafana at http://localhost:3000

All data sources are pre-configured and ready to use in Grafana.
