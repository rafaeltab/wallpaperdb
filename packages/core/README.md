# @wallpaperdb/core

Shared infrastructure patterns for WallpaperDB services.

## Installation

```bash
pnpm add @wallpaperdb/core
```

## Modules

### Connections (`@wallpaperdb/core/connections`)

Factory functions for creating and managing infrastructure connections:

- `createPool()` - PostgreSQL connection pool
- `createS3Client()` - S3/MinIO client
- `createNatsConnection()` - NATS client with JetStream
- `createRedisClient()` - Redis client
- `createOtelSdk()` - OpenTelemetry SDK

Each factory includes a health check function (e.g., `checkPoolHealth()`).

### Base Connection (`@wallpaperdb/core/connections/base`)

Abstract `BaseConnection` class for building service-specific connection managers with:

- Lifecycle management (connect/disconnect)
- Health checking
- Graceful shutdown support

### Config (`@wallpaperdb/core/config`)

Zod-based configuration schemas and utilities:

**Schemas:**
- `ServerConfigSchema` - port, nodeEnv
- `DatabaseConfigSchema` - databaseUrl
- `S3ConfigSchema` - MinIO/S3 configuration
- `NatsConfigSchema` - NATS configuration
- `RedisConfigSchema` - Redis configuration
- `OtelConfigSchema` - OpenTelemetry configuration

**Utilities:**
- `parseIntEnv()` - Parse integer from environment variable
- `parseBoolEnv()` - Parse boolean from environment variable
- `getEnv()` - Get environment variable with default
- `requireEnv()` - Get required environment variable (throws if missing)
- `createConfigLoader()` - Create a config loader function

**Usage:**

```typescript
import { z } from "zod";
import {
  ServerConfigSchema,
  DatabaseConfigSchema,
  parseIntEnv,
  getEnv,
} from "@wallpaperdb/core/config";

// Compose schemas using spread on .shape
const configSchema = z.object({
  ...ServerConfigSchema.shape,
  ...DatabaseConfigSchema.shape,
  // Add service-specific fields
  myServiceField: z.string().default("default"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: parseIntEnv(process.env.PORT, 3001),
    nodeEnv: getEnv("NODE_ENV", "development"),
    databaseUrl: process.env.DATABASE_URL,
    myServiceField: process.env.MY_SERVICE_FIELD,
  });
}
```

### Health (`@wallpaperdb/core/health`)

Health check aggregation utilities:

**Classes:**
- `HealthAggregator` - Aggregates multiple health checks with timeout handling

**Types:**
- `HealthResponse` - Aggregated health response
- `ReadyResponse` - Kubernetes-style readiness response
- `LiveResponse` - Kubernetes-style liveness response

**Formatters:**
- `getHealthStatusCode()` - Get HTTP status code for health response
- `getReadyStatusCode()` - Get HTTP status code for ready response
- `getLiveStatusCode()` - Get HTTP status code for live response

**Usage:**

```typescript
import { HealthAggregator, getHealthStatusCode } from "@wallpaperdb/core/health";

const aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

aggregator.register("database", async () => checkPoolHealth(pool));
aggregator.register("nats", async () => checkNatsHealth(nc));

// In route handler
const result = await aggregator.checkHealth();
reply.code(getHealthStatusCode(result)).send(result);
```

### Errors (`@wallpaperdb/core/errors`)

RFC 7807 Problem Details error classes:

- `ProblemDetailsError` - Base class for HTTP problem details
- `ApplicationError` - Base class for application errors
- Standard errors: `InternalError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`

### Telemetry (`@wallpaperdb/core/telemetry`)

OpenTelemetry helpers (no DI coupling):

- `withSpan()` - Wrap async function in a span
- `withSpanSync()` - Wrap sync function in a span
- `getTracer()` - Get the tracer instance
- `getMeter()` - Get the meter instance
- `recordCounter()` / `recordHistogram()` - Record metrics
- `Attributes` - Standard attribute keys

## License

Private - Anthropic
