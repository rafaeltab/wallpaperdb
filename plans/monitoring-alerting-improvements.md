# Monitoring and Alerting Improvements

> **Status:** Mostly Complete (90%)
> **Priority:** Low (minor enhancements remaining)
> **Estimated Effort:** 1-2 days (for remaining items)

## Overview

Production observability with dashboards and alerts is operational. Minor enhancements remain.

## Completed ✅

- ✅ **Alerts configured** (4 critical alerts in Grafana)
  - High Upload Failure Rate (>5%)
  - Slow Upload Response Time (p95 >10s)
  - Storage Operation Failures
  - Reconciliation Errors

- ✅ **Service dashboards created**
  - Upload Overview (Ingestor)
  - Media Overview
  - Gateway Overview
  - Gateway Security

## Remaining Work

### Missing Dashboards

**Infrastructure Dashboard** (not yet created)
- PostgreSQL pool usage and connection metrics
- NATS consumer lag and pending messages
- Redis memory usage and hit rates
- MinIO bandwidth and storage metrics
- OpenSearch index health

**Variant Generator Dashboard** (not yet created)
- Variant generation rate
- Processing duration by resolution
- Error rate by aspect ratio

**Missing Metrics**
- Database connection pool exhaustion warnings
- NATS consumer lag alerts (when >10,000 pending)
- Redis memory usage alerts

**SLO Tracking** (not yet implemented)
- Define and track Service Level Objectives
- Example: 99.9% uptime, p95 response time <500ms

## Additional Alerts to Add

```yaml
# Database pool exhaustion (missing)
- alert: DatabasePoolExhausted
  expr: pg_connections / pg_max_connections > 0.8
  for: 2m
  severity: critical
  description: PostgreSQL connection pool is >80% utilized

# NATS consumer lag (missing)
- alert: ConsumerLag
  expr: nats_consumer_num_pending > 10000
  for: 5m
  severity: warning
  description: NATS consumer has >10,000 pending messages

# High GraphQL error rate (missing)
- alert: HighGraphQLErrorRate
  expr: rate(graphql_requests_total{status="error"}[5m]) > 0.01
  for: 5m
  severity: warning
  description: GraphQL error rate >1%
```

## Acceptance Criteria

- [x] Core service dashboards created (Ingestor, Media, Gateway)
- [x] Critical alerts configured (uploads, storage, reconciliation)
- [ ] Infrastructure dashboard created
- [ ] Variant Generator dashboard created
- [ ] Additional alerts (DB pool, consumer lag, GraphQL errors)
- [ ] SLO tracking implemented
- [ ] Notification channels configured (email, Slack, etc.)
