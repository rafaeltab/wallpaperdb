# Shared Packages Architecture

This document describes the shared packages in the WallpaperDB monorepo and how they enable rapid multi-service development.

## Overview

WallpaperDB uses a monorepo structure with shared packages that provide common infrastructure patterns. This allows new services to be built quickly (~1 week) by reusing tested, production-ready code.

## Package Structure

```
packages/
├── core/                    # Infrastructure patterns
│   ├── connections/         # Database, MinIO, NATS, Redis, OTEL
│   ├── config/             # Zod-based configuration
│   ├── health/             # Health check aggregation
│   ├── errors/             # RFC 7807 error handling
│   └── telemetry/          # OpenTelemetry helpers
├── events/                  # Event schemas and pub/sub
│   ├── schemas/            # Zod event schemas
│   ├── publisher/          # BaseEventPublisher
│   └── consumer/           # BaseEventConsumer
├── testcontainers/         # Test infrastructure
└── test-utils/             # Test utilities
```

## @wallpaperdb/core

### Purpose

Provides foundational infrastructure patterns that all services need.

### Key Principles

1. **No DI Coupling** - All utilities use static imports, not dependency injection
2. **Factory Functions** - Connections are created via factory functions
3. **Composable Config** - Services compose their config from shared schemas
4. **Testable** - All utilities have comprehensive unit tests

### Modules

#### Connections (`@wallpaperdb/core/connections`)

Factory functions for creating infrastructure connections:

```typescript
import { createPool, checkPoolHealth } from "@wallpaperdb/core/connections";

const pool = createPool({ connectionString: config.databaseUrl });
const healthy = await checkPoolHealth(pool);
```

Services typically extend `BaseConnection` for their own connection managers:

```typescript
import { BaseConnection } from "@wallpaperdb/core/connections/base";

@injectable()
export class DatabaseConnection extends BaseConnection {
  async doConnect(): Promise<void> { /* ... */ }
  async doDisconnect(): Promise<void> { /* ... */ }
  async checkHealth(): Promise<boolean> { /* ... */ }
}
```

#### Config (`@wallpaperdb/core/config`)

Zod-based configuration with composable schemas:

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
  // Service-specific
  myOption: z.string().default("default"),
});

export type Config = z.infer<typeof configSchema>;
```

#### Health (`@wallpaperdb/core/health`)

Health check aggregation with timeout handling:

```typescript
import { HealthAggregator, getHealthStatusCode } from "@wallpaperdb/core/health";

const aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });
aggregator.register("database", async () => checkPoolHealth(pool));
aggregator.register("nats", async () => checkNatsHealth(nc));

// Kubernetes-style probes
aggregator.setInitialized(true);  // /ready returns 200
aggregator.setShuttingDown(true); // /ready returns 503
```

#### Telemetry (`@wallpaperdb/core/telemetry`)

OpenTelemetry helpers without DI coupling:

```typescript
import { withSpan, Attributes } from "@wallpaperdb/core/telemetry";

async function processUpload(userId: string) {
  return withSpan("upload.process", { [Attributes.USER_ID]: userId }, async (span) => {
    span.addEvent("validation.started");
    // ... process upload
    return result;
  });
}
```

## @wallpaperdb/events

### Purpose

Event schemas and pub/sub abstractions for inter-service communication.

### Key Principles

1. **Schema Validation** - All events are validated with Zod
2. **Trace Propagation** - OpenTelemetry context propagated in NATS headers
3. **Type Safety** - Full TypeScript support via schema inference

### Event Schemas

```typescript
import { createEventSchema, WallpaperUploadedEventSchema } from "@wallpaperdb/events";

// Custom event schema
const MyEventSchema = createEventSchema({
  userId: z.string(),
  action: z.enum(["created", "updated"]),
});
```

### Publishers

```typescript
import { BaseEventPublisher } from "@wallpaperdb/events";

class WallpaperUploadedPublisher extends BaseEventPublisher<typeof WallpaperUploadedEventSchema> {
  constructor(js: JetStreamClient) {
    super({
      js,
      subject: WALLPAPER_UPLOADED_SUBJECT,
      schema: WallpaperUploadedEventSchema,
      serviceName: "ingestor",
    });
  }
}
```

### Consumers

```typescript
import { BaseEventConsumer, type MessageContext } from "@wallpaperdb/events";

class WallpaperUploadedConsumer extends BaseEventConsumer<typeof WallpaperUploadedEventSchema> {
  protected async handleMessage(
    event: WallpaperUploadedEvent,
    context: MessageContext
  ): Promise<void> {
    // Process the event
  }
}
```

## Service Integration Pattern

### 1. Create Config

```typescript
// src/config.ts
import { z } from "zod";
import {
  ServerConfigSchema,
  DatabaseConfigSchema,
  NatsConfigSchema,
  parseIntEnv,
  getEnv,
} from "@wallpaperdb/core/config";

const configSchema = z.object({
  ...ServerConfigSchema.shape,
  ...DatabaseConfigSchema.shape,
  ...NatsConfigSchema.shape,
  // Service-specific
});

export function loadConfig() {
  return configSchema.parse({
    port: parseIntEnv(process.env.PORT, 3001),
    nodeEnv: getEnv("NODE_ENV", "development"),
    databaseUrl: process.env.DATABASE_URL,
    natsUrl: process.env.NATS_URL,
  });
}
```

### 2. Create Connection Managers

```typescript
// src/connections/database.ts
import { BaseConnection, createPool } from "@wallpaperdb/core/connections";

@injectable()
export class DatabaseConnection extends BaseConnection {
  private pool: Pool | null = null;

  async doConnect() {
    this.pool = createPool({ connectionString: this.config.databaseUrl });
  }

  async doDisconnect() {
    await this.pool?.end();
  }
}
```

### 3. Set Up Health Checks

```typescript
// src/services/health.service.ts
import { HealthAggregator } from "@wallpaperdb/core/health";

@injectable()
export class HealthService {
  private aggregator = new HealthAggregator();

  constructor(
    @inject(DatabaseConnection) db: DatabaseConnection,
    @inject(NatsConnection) nats: NatsConnection,
  ) {
    this.aggregator.register("database", () => db.checkHealth());
    this.aggregator.register("nats", () => nats.checkHealth());
  }
}
```

### 4. Create Event Publisher/Consumer

```typescript
// src/services/publishers/my-event.publisher.ts
import { BaseEventPublisher } from "@wallpaperdb/events";

export class MyEventPublisher extends BaseEventPublisher<typeof MyEventSchema> {
  constructor(js: JetStreamClient) {
    super({
      js,
      subject: "my.event.subject",
      schema: MyEventSchema,
      serviceName: "my-service",
    });
  }
}
```

## Testing

### Test Containers

```typescript
import { PostgresBuilder, NatsBuilder } from "@wallpaperdb/testcontainers";

const postgres = await new PostgresBuilder().start();
const nats = await new NatsBuilder().start();
```

### Test Utilities

```typescript
import { TesterBuilder } from "@wallpaperdb/test-utils";

const tester = await TesterBuilder.create()
  .withPostgres()
  .withNats()
  .build();
```

## Migration Guide

When extracting code to shared packages:

1. **Identify Common Patterns** - Look for code duplicated across services
2. **Extract to Package** - Create new package under `packages/`
3. **Add Tests** - Comprehensive unit tests are required
4. **Update Services** - Import from package instead of local code
5. **Document** - Update this document and package README

## Related Documents

- [ADR-001: Fastify over NestJS](decisions/001-fastify-over-nestjs.md)
- [Multi-Service Architecture Plan](../../plans/multi-service-architecture.md)
- [Testing Documentation](../testing/README.md)
