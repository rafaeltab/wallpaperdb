# Observability Guide

This guide covers how to add telemetry to WallpaperDB services and use the monitoring infrastructure.

## Overview

WallpaperDB uses OpenTelemetry for distributed tracing and metrics, with the Grafana LGTM stack for visualization:

- **Loki** - Log aggregation
- **Grafana** - Dashboards and alerting
- **Tempo** - Distributed tracing
- **Mimir** - Metrics storage (Prometheus-compatible)

## Quick Start

```bash
# Start infrastructure (includes LGTM stack)
make infra-start

# Access Grafana
open http://localhost:3000
# Default credentials: admin/admin
```

## Adding Telemetry to Services

### Import Telemetry Utilities

```typescript
import {
  Attributes,
  withSpan,
  withSpanSync,
  recordCounter,
  recordHistogram,
} from '@wallpaperdb/core/telemetry';
```

### Wrapping Async Operations with Spans

```typescript
async myAsyncOperation(userId: string, data: SomeData): Promise<Result> {
  return await withSpan(
    'service.operation_name',
    {
      [Attributes.USER_ID]: userId,
      // Add relevant attributes
    },
    async (span) => {
      // Your business logic here

      // Add attributes as you learn more
      span.setAttribute('custom_attr', someValue);

      // Record events for significant moments
      span.addEvent('processing_complete');

      return result;
    }
  );
}
```

### Wrapping Sync Operations

```typescript
calculateSomething(data: Buffer): string {
  return withSpanSync(
    'service.calculate_something',
    { [Attributes.FILE_SIZE_BYTES]: data.length },
    (span) => {
      const result = doCalculation(data);
      span.setAttribute('result_length', result.length);
      return result;
    }
  );
}
```

### Recording Metrics

```typescript
// Counters (for counting events)
recordCounter('upload.requests.total', 1, {
  status: 'success',
  [Attributes.FILE_TYPE]: 'image',
});

// Histograms (for durations, sizes)
recordHistogram('upload.duration_ms', durationMs, {
  status: 'success',
});
```

## Available Attributes

Standard attributes are defined in `@wallpaperdb/core/telemetry`:

```typescript
import { Attributes } from '@wallpaperdb/core/telemetry';

// User context
Attributes.USER_ID           // "user.id"

// Wallpaper context
Attributes.WALLPAPER_ID      // "wallpaper.id"
Attributes.WALLPAPER_STATE   // "wallpaper.state"

// File context
Attributes.FILE_TYPE         // "file.type"
Attributes.FILE_MIME_TYPE    // "file.mime_type"
Attributes.FILE_SIZE_BYTES   // "file.size_bytes"
Attributes.FILE_WIDTH        // "file.width"
Attributes.FILE_HEIGHT       // "file.height"
Attributes.FILE_HASH         // "file.hash"

// Storage context
Attributes.STORAGE_BUCKET    // "storage.bucket"
Attributes.STORAGE_KEY       // "storage.key"

// Operation context
Attributes.OPERATION_NAME    // "operation.name"
Attributes.OPERATION_SUCCESS // "operation.success"

// Error context
Attributes.ERROR_TYPE        // "error.type"
Attributes.ERROR_MESSAGE     // "error.message"

// Reconciliation context
Attributes.RECONCILIATION_TYPE              // "reconciliation.type"
Attributes.RECONCILIATION_RECORDS_FOUND     // "reconciliation.records_found"
Attributes.RECONCILIATION_RECORDS_PROCESSED // "reconciliation.records_processed"

// Event context
Attributes.EVENT_TYPE             // "event.type"
Attributes.EVENT_ID               // "event.id"
Attributes.EVENT_SUBJECT          // "event.subject"
Attributes.EVENT_STREAM           // "event.stream"
Attributes.EVENT_CONSUMER         // "event.consumer"
Attributes.EVENT_DELIVERY_ATTEMPT // "event.delivery_attempt"
```

## Metrics Reference

### Upload Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `upload.requests.total` | Counter | `status`, `file.type` | Total upload requests |
| `upload.duration_ms` | Histogram | `status`, `file.type` | Upload duration |
| `upload.file_size_bytes` | Histogram | `file.type` | Upload file sizes |
| `upload.state_transitions.total` | Counter | `from_state`, `to_state`, `success` | State machine transitions |

### Storage Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `storage.operations.total` | Counter | `operation.name`, `operation.success` | S3 operations count |
| `storage.operation_duration_ms` | Histogram | `operation.name`, `operation.success` | S3 operation duration |

### File Processing Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `file_processor.total_duration_ms` | Histogram | `file.type` | Total processing time |
| `file_processor.hash_duration_ms` | Histogram | `file.size_bytes` | Hash calculation time |
| `file_processor.metadata_extraction_duration_ms` | Histogram | `file.size_bytes` | Metadata extraction time |

### Reconciliation Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `reconciliation.cycles.total` | Counter | `reconciliation.type` | Reconciliation cycles |
| `reconciliation.records_processed.total` | Counter | `reconciliation.type` | Records processed |
| `reconciliation.cycle_duration_ms` | Histogram | `reconciliation.type` | Cycle duration |
| `reconciliation.errors.total` | Counter | `reconciliation.type`, `error.type` | Errors during reconciliation |

### Event Publishing Metrics (from @wallpaperdb/events)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `events.published.total` | Counter | `event.type`, `success` | Events published |
| `events.publish_duration_ms` | Histogram | `event.type` | Publish duration |

## Dashboards

Pre-built dashboards are available in Grafana:

### Upload Overview Dashboard

Located at: `infra/grafana/dashboards/upload-overview.json`

Panels:
- Successful/Failed/Duplicate uploads (rate)
- Upload duration percentiles (p50, p95, p99)
- Upload request rate by status
- State machine transitions
- Storage operation duration and rate
- File processing duration
- Reconciliation records and errors

## Alerts

Pre-configured alerts in `infra/grafana/provisioning/alerting/alerting.yaml`:

| Alert | Threshold | Severity | Description |
|-------|-----------|----------|-------------|
| High Upload Failure Rate | >5% failures | Warning | Upload failure rate exceeded |
| Slow Upload Response Time | p95 >10s | Warning | Upload latency is high |
| Storage Operation Failures | Any failures | Critical | MinIO operations failing |
| Reconciliation Errors | >5 errors/5min | Warning | Background job errors |

## Testing

OTEL automatically provides no-op tracer/meter when SDK is not started. This means:
- No special test setup needed
- Zero overhead in tests
- Spans and metrics are silently ignored

## Best Practices

1. **Use standard attributes** - Import from `Attributes` to ensure consistency
2. **Add context progressively** - Start with known attributes, add more as you learn
3. **Instrument at boundaries** - Focus on entry points and external calls
4. **Use meaningful span names** - Format: `service.operation` (e.g., `storage.s3.put_object`)
5. **Record metrics for aggregations** - Spans for debugging, metrics for dashboards
6. **Handle errors gracefully** - `withSpan` automatically records exceptions

## Troubleshooting

### No metrics appearing in Grafana

1. Check OTLP endpoint is configured:
   ```
   OTLP_ENDPOINT=http://localhost:4318
   ```

2. Verify LGTM container is running:
   ```bash
   docker ps | grep lgtm
   ```

3. Check service logs for OTEL errors

### Traces not connecting

Ensure trace context is propagated. The `@wallpaperdb/events` package automatically propagates context to NATS headers. For HTTP calls, use the OpenTelemetry HTTP instrumentation.

### High cardinality warnings

Avoid using high-cardinality values as metric labels (e.g., user IDs, wallpaper IDs). Use spans for per-request debugging instead.
