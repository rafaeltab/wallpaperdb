# Local Infrastructure Plan

## Overview

There are several big parts to this project:
1. Storing wallpapers, and retrieving them efficiently
2. Searching and filtering the wallpapers
3. Enriching wallpaper information for use with filtering and searching
4. Managing metadata and user data
5. Observability and monitoring

All local infra will use Docker Compose (no Kubernetes).

## Technology Stack

### 1. Object Storage - MinIO
**Purpose**: Store wallpaper images efficiently with S3-compatible API

**Why MinIO**:
- S3-compatible API (easy migration to production)
- Built-in access control and bucket policies
- Excellent performance for object storage
- Lightweight and Docker-friendly

**Configuration**:
- Persistent volume for data
- Console UI for management (port 9001)
- API endpoint (port 9000)
- Default bucket: `wallpapers`

### 2. Metadata Database - PostgreSQL
**Purpose**: Store wallpaper metadata, user info, ownership, tags, etc.

**Why PostgreSQL**:
- Strong ACID guarantees for critical metadata
- Rich querying capabilities
- JSONB support for flexible metadata
- Excellent ecosystem and tooling

**Configuration**:
- Version: 16 (latest stable)
- Persistent volume for data
- Default database: `wallpaperdb`

### 3. Search Engine - OpenSearch
**Purpose**: Fast full-text search and filtering of wallpapers

**Why OpenSearch**:
- Open-source and Apache 2.0 licensed
- Powerful search and aggregation capabilities
- Good for flexible schema
- Active development and AWS backing

**Configuration**:
- Single node for local dev
- OpenSearch Dashboards for visualization

### 4. Message Queue - NATS
**Purpose**: Async communication between services for enrichment tasks

**Why NATS**:
- Extremely lightweight and fast
- Simple to configure
- JetStream for persistence and guaranteed delivery
- Perfect for microservices communication
- Lower resource footprint than Kafka/RedPanda

### 5. Observability Stack

#### Grafana
- Central dashboard for all observability
- Supports metrics, logs, and traces

#### Prometheus
- Metrics collection and storage
- Service discovery for Docker containers

#### Loki
- Log aggregation
- Integrates seamlessly with Grafana

#### Tempo
- Distributed tracing
- OTLP support for OpenTelemetry

#### OTEL Collector
- Central collector for all telemetry
- Routes to Prometheus, Loki, and Tempo

## Docker Compose Structure

### Volumes
- `postgres-data`: PostgreSQL data
- `minio-data`: MinIO object storage
- `opensearch-data`: OpenSearch indices
- `nats-data`: NATS JetStream storage
- `prometheus-data`: Prometheus metrics
- `loki-data`: Loki logs
- `tempo-data`: Tempo traces
- `grafana-data`: Grafana dashboards

### Port Mappings (Local Dev)
- `5432`: PostgreSQL
- `9000`: MinIO API
- `9001`: MinIO Console
- `4222`: NATS Client
- `8222`: NATS Monitoring
- `9200`: OpenSearch API
- `5601`: OpenSearch Dashboards
- `3000`: Grafana
- `9090`: Prometheus
- `3100`: Loki
- `4317`: OTEL Collector (gRPC)
- `4318`: OTEL Collector (HTTP)

Got to make sure there are no conflicting ports here!

### Environment Variables
Use `.env` file for local development:
- Database credentials
- MinIO access keys
- NATS credentials
- Service URLs

## Initial Setup Steps

1. Create turbo workspace for local infra
2. Create `docker-compose.yml` with all infrastructure services
3. Create initialization scripts:
   - PostgreSQL schema initialization (only add an example table)
   - MinIO bucket creation (only add an example bucket)
   - OpenSearch index templates (only add an example index)
   - NATS stream/consumer setup (only add an example stream)
4. Create helper scripts:
   - `start-infra.sh` - Start all services
   - `stop-infra.sh` - Stop all services
   - `reset-infra.sh` - Reset all data
   - `logs.sh` - Tail logs from all services
5. Create `.env.example` template
6. Make sure you can start the local infra using a Makefile, and it has to go through Turborepo

## Future Considerations

- Redis for caching (if needed for performance)
- API rate limiting (could use Redis)
- CDN for serving popular wallpapers
- Image transformation service (thumbnails, format conversion)
