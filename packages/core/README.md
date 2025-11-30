# @wallpaperdb/core

Shared infrastructure patterns for all WallpaperDB services.

## Documentation

**Complete documentation:** [apps/docs/content/docs/packages/core.mdx](../../apps/docs/content/docs/packages/core.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Example

```typescript
import { DatabaseConnection, MinioConnection } from '@wallpaperdb/core/connections';
import { ServerConfigSchema, DatabaseConfigSchema } from '@wallpaperdb/core/config';
import { withSpan, Attributes } from '@wallpaperdb/core/telemetry';
import { ProblemDetailsError } from '@wallpaperdb/core/errors';

// Compose config schemas
const config = z.object({
  ...ServerConfigSchema.shape,
  ...DatabaseConfigSchema.shape,
}).parse(process.env);

// Use OpenTelemetry helpers
await withSpan('my.operation', { [Attributes.USER_ID]: userId }, async (span) => {
  // Business logic
});
```

## Modules

- **Connections**: DatabaseConnection, MinioConnection, NatsConnectionManager, RedisConnection, OtelConnection
- **Config**: Composable Zod schemas (Server, Database, S3, NATS, Redis, OTEL)
- **Telemetry**: OpenTelemetry helpers (withSpan, recordCounter, recordHistogram)
- **Errors**: RFC 7807 error classes (ProblemDetailsError, ApplicationError)
- **Health**: Health check aggregation (HealthAggregator)
- **OpenAPI**: OpenAPI registration helpers

**See the [complete documentation](../../apps/docs/content/docs/packages/core.mdx) for detailed API reference.**
