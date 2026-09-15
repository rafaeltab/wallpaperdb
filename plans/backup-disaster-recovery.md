# Backup and Disaster Recovery Strategy

> **Status:** Planned  
> **Priority:** High  
> **Estimated Effort:** 1 week  

## Overview

Implement automated backups for all stateful services.

## Current State

**No backups configured for:**
- PostgreSQL (volatile Docker volumes)
- S3 (no replication)
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

### S3 Object Storage Backup

Back up SeaweedFS objects to an independent S3 endpoint with a tool that supports separate source and destination endpoints and preserves object content, content types, and user metadata. Configure credentials independently for each endpoint.

- Retain previous versions or dated snapshots so deletion or corruption is recoverable.
- Verify copied objects and metadata, and rehearse restoring them alongside the database.
- Measure achievable backup frequency and recovery time before committing to the targets below.

### NATS Backup

```bash
# Snapshot stream
nats stream backup WALLPAPER /backups/nats/
```

## Recovery Time Objectives

| Service | RPO (Data Loss) | RTO (Recovery) | Frequency |
|---------|----------------|----------------|-----------|
| PostgreSQL | 24 hours | 1 hour | Daily |
| S3 | Near-zero | 2 hours | Continuous |
| NATS | 24 hours | 30 min | Daily |

## Acceptance Criteria

- [ ] Automated daily backups
- [ ] Backups uploaded to S3
- [ ] Restore procedures tested
- [ ] Monitoring alerts configured
