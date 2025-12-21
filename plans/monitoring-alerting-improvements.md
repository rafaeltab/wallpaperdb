# Monitoring and Alerting Improvements

> **Status:** Planned  
> **Priority:** Medium  
> **Estimated Effort:** 1 week  

## Overview

Add comprehensive dashboards and proactive alerts.

## Missing

- No alerts configured
- Incomplete dashboards (missing Ingestor, Gateway)
- No SLO tracking
- Missing critical metrics (connection pool, consumer lag)

## Dashboards to Create

### Ingestor Dashboard
- Upload rate, success rate
- Processing duration (P95, P99)
- State machine distribution
- Reconciliation metrics

### Gateway Dashboard
- Query rate, complexity
- Rejected queries
- OpenSearch latency

### Infrastructure Dashboard
- PostgreSQL pool usage
- NATS consumer lag
- Redis memory
- MinIO bandwidth

## Critical Alerts

```yaml
# High error rate
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.01
  for: 5m
  severity: critical

# Database pool exhaustion
- alert: DatabasePoolExhausted
  expr: pg_connections / pg_max_connections > 0.8
  severity: critical

# NATS consumer lag
- alert: ConsumerLag
  expr: nats_consumer_num_pending > 10000
  severity: warning
```

## Acceptance Criteria

- [ ] All services have dashboards
- [ ] Critical alerts configured
- [ ] SLO tracking implemented
- [ ] Notification channels set up
