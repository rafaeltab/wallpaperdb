# Tag service Effect migration evidence

[Watch the browser recording](tag-service-effect.mp4). 44 seconds, H.264 MP4, 416,520 bytes.

Recorded on 2026-09-26 against the production image built from `09acb3c2`, with real PostgreSQL, NATS, and the local OpenTelemetry collector. The service ran with `NODE_ENV=production`. Frames at 15 and 40 seconds were inspected.

The recording executes `GET /health` through Swagger UI, showing HTTP 200 with database, NATS, and telemetry checks all true. It then opens `/ready`, which returns `ready: true`, and `/tags`, which returns 404 Problem Details because no tag operations exist. It ends on the successful health response. No browser responses were mocked and no domain fixtures were seeded.

This demonstrates the operational skeleton. The separate image E2E test builds the actual Dockerfile and verifies nonempty OTLP traces, logs, and metrics after shutdown. The recording alone does not establish telemetry export or cancellation guarantees.

The recording predates the HTTP parser-error fix in `13b00348`. That fix preserves these successful requests; raw TCP regression tests provide evidence for malformed and oversized requests.

## Artifact identity

- Production image ID: `sha256:bc024d3feb758962ce14439523223d225407231270148abfc13aa22c522f69b4`.
- Recording SHA-256: `b134a52800eb1f6c76eab5585f406d816c006e8fa7ee4554bebbc7c14813c9df`.
