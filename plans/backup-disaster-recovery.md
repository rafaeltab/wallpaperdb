# Backup and Disaster Recovery Strategy

> **Status:** Planned  
> **Priority:** High  
> **Estimated Effort:** 1 week  

## Overview

Implement automated backups for all stateful services.

## Current State

**No backups configured for:**
- PostgreSQL (volatile Docker volumes)
- MinIO (no replication)
- NATS JetStream
- Redis
- OpenSearch

## Solution

### PostgreSQL Backup

```bash
#!/bin/bash
# Daily backup with pg_dump
docker exec wallpaperdb-postgres pg_dump \
  -U wallpaperdb \
  --format=custom \
  | gzip > "/backups/postgres_$(date +%Y%m%d).sql.gz"

# Upload to S3 (production)
aws s3 cp backup.sql.gz s3://wallpaperdb-backups/
```

### MinIO Backup

```bash
# Enable versioning
mc version enable myminio/wallpapers

# Replicate to backup bucket
mc mirror myminio/wallpapers s3://wallpaperdb-backups/minio/
```

### NATS Backup

```bash
# Snapshot stream
nats stream backup WALLPAPER /backups/nats/
```

## Recovery Time Objectives

| Service | RPO (Data Loss) | RTO (Recovery) | Frequency |
|---------|----------------|----------------|-----------|
| PostgreSQL | 24 hours | 1 hour | Daily |
| MinIO | Near-zero | 2 hours | Continuous |
| NATS | 24 hours | 30 min | Daily |

## Acceptance Criteria

- [ ] Automated daily backups
- [ ] Backups uploaded to S3
- [ ] Restore procedures tested
- [ ] Monitoring alerts configured
