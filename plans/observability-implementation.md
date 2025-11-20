# Observability Implementation Plan

**Status:** Planning
**Parent Plan:** [Multi-Service Architecture](./multi-service-architecture.md)
**Duration:** 2 weeks (Phase 1)
**Prerequisites:** Shared packages created (Phase 0)

---

## Overview

Implement production-grade observability using OpenTelemetry with **no DI coupling**. Telemetry should be easy to add via static imports.

---

## Design Principles

1. **No DI Dependency** - Import telemetry directly as modules
2. **Thin Wrapper Helpers** - Ergonomic API over OTEL (`withSpan`, `recordMetric`)
3. **OTEL Conventions** - Follow standard patterns (no-op provider in tests)
4. **Easy to Add** - Minimal friction for instrumentation

---

## Week 1: Core Instrumentation

### Day 1-2: Telemetry Module (in @wallpaperdb/core)

**Create:** `packages/core/src/telemetry/`

**Files:**
- `index.ts` - Helper functions (withSpan, recordMetric, addEvent)
- `metrics.ts` - Pre-defined metrics (uploadRequestsCounter, etc.)
- `attributes.ts` - Attribute key constants (WALLPAPER_ID, USER_ID, etc.)

**Testing:** No-op in test environment (OTEL convention - don't call sdk.start())

### Day 3-4: Instrument Upload Orchestrator

**Add spans:**
- `upload.orchestrator.handle_upload` (root span)
- Add attributes: wallpaper.id, user.id, file.type, file.size_bytes
- Record metrics: uploadRequestsCounter, uploadDurationHistogram

**Pattern:**
```typescript
import { withSpan } from '@wallpaperdb/core/telemetry';
import { uploadRequestsCounter } from '@wallpaperdb/core/telemetry/metrics';
import { Attributes } from '@wallpaperdb/core/telemetry/attributes';

async handleUpload(params: UploadParams) {
  const startTime = Date.now();

  return await withSpan(
    'upload.orchestrator.handle_upload',
    { [Attributes.USER_ID]: params.userId },
    async (span) => {
      // business logic
      span.setAttribute(Attributes.WALLPAPER_ID, wallpaperId);

      uploadRequestsCounter.add(1, {
        [Attributes.UPLOAD_STATUS]: 'success',
      });

      return result;
    }
  );
}
```

### Day 5: Instrument Storage Service

**Add spans:**
- `storage.s3.put_object` (S3 not auto-instrumented!)
- `storage.s3.head_object`
- `storage.s3.delete_object`

**Add metrics:**
- `storageOperationDuration`
- `storageOperationsCounter`

---

## Week 2: Complete Instrumentation

### Day 6-7: Instrument Events + File Processor

**Events Service:**
- Span: `events.nats.publish`
- **CRITICAL:** Trace context propagation to NATS headers
- Metrics: eventsPublishedCounter

**File Processor:**
- Span: `file_processor.calculate_hash` (CPU-intensive)
- Span: `file_processor.extract_metadata` (Sharp - expensive)
- Track processing time

### Day 8: State Machine + Reconciliation

**State Machine:**
- Metrics: `upload.state_transitions.total`
- Observable gauge: `upload.states.current`

**Reconciliation:**
- Modify BaseReconciliation to use telemetry helpers
- Track cycle duration, records processed

### Day 9: Dashboards

**Create in Grafana:**
1. Upload Overview (request rate, duration p95, failure rate)
2. Infrastructure Health (MinIO/NATS latency, DB pool)
3. Service Template (reusable for all services)

### Day 10: Alerts + Documentation

**Alert Rules:**
- High failure rate (>5%)
- Slow uploads (p95 >10s)
- Infrastructure failures

**Documentation:**
- How to add telemetry to new services
- Dashboard templates
- Alert playbooks

---

## Span Hierarchy

```
HTTP POST /upload (auto-instrumented by Fastify)
├── upload.orchestrator.handle_upload
│   ├── file_processor.process
│   │   ├── file_processor.calculate_hash
│   │   ├── file_processor.detect_mime_type
│   │   └── file_processor.extract_metadata
│   ├── upload.orchestrator.check_duplicate
│   ├── upload.orchestrator.record_intent
│   └── upload.orchestrator.execute_upload
│       ├── state_machine.transition_to_uploading
│       ├── storage.s3.put_object
│       ├── state_machine.transition_to_stored
│       └── events.nats.publish
```

---

## Key Metrics

**Upload:**
- `upload.requests.total` (counter by status, file_type)
- `upload.duration` (histogram by status, file_type)
- `upload.file_size` (histogram by file_type)

**Storage:**
- `storage.operation_duration` (histogram by operation)
- `storage.operations.total` (counter by operation, status)

**Events:**
- `events.published.total` (counter by event_type, status)
- `events.publish_duration` (histogram)

**State Machine:**
- `upload.state_transitions.total` (counter by from_state, to_state)
- `upload.states.current` (gauge by state)

---

## Trace Context Propagation

**CRITICAL for distributed tracing:**

```typescript
import { propagation, context } from '@opentelemetry/api';

async publishUploadedEvent(wallpaper: Wallpaper) {
  const headers = {};

  // Inject trace context into NATS headers
  propagation.inject(context.active(), headers);

  await js.publish('wallpaper.uploaded', JSON.stringify(event), {
    headers: {
      ...headers, // <- Trace context propagated!
      'event-id': ulid(),
    }
  });
}
```

This enables tracing: Ingestor → NATS → Service #2

---

## Testing Telemetry

**OTEL Convention:**
- In test environment, skip `sdk.start()` in otel.connection.ts
- OTEL automatically provides no-op tracer/meter
- Zero overhead, no special test setup

**Optional:** In-memory collector for testing instrumentation correctness

---

## Success Criteria

✅ Telemetry module exists in @wallpaperdb/core
✅ No DI coupling - static imports work
✅ Upload workflow fully instrumented
✅ Storage, Events, FileProcessor instrumented
✅ Distributed tracing works (trace propagates to NATS)
✅ Grafana dashboards created
✅ Alerts configured
✅ Documentation complete
✅ Patterns ready for Service #2

---

## Next: Architecture Refinement

See [Architecture Refinement Plan](./architecture-refinement.md)
