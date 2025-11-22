# @wallpaperdb/events

Event schemas and pub/sub abstractions for WallpaperDB services.

## Installation

```bash
pnpm add @wallpaperdb/events
```

## Overview

This package provides:

1. **Event Schemas** - Zod schemas for validating event payloads
2. **BaseEventPublisher** - Abstract class for publishing events to NATS JetStream
3. **BaseEventConsumer** - Abstract class for consuming events from NATS JetStream

## Event Schemas

### Base Event Schema

All events extend `BaseEventSchema` with common fields:

```typescript
import { createEventSchema } from "@wallpaperdb/events";

const MyEventSchema = createEventSchema({
  // Event-specific fields
  userId: z.string(),
  action: z.enum(["created", "updated", "deleted"]),
});
```

### WallpaperUploaded Event

```typescript
import {
  WallpaperUploadedEventSchema,
  WALLPAPER_UPLOADED_SUBJECT,
} from "@wallpaperdb/events";

// Subject: "wallpaper.uploaded"
const event = WallpaperUploadedEventSchema.parse({
  wallpaperId: "wlpr_01ABC...",
  userId: "user_123",
  contentHash: "sha256:...",
  fileType: "image",
  mimeType: "image/jpeg",
  fileSizeBytes: 1024000,
  width: 1920,
  height: 1080,
  aspectRatio: "1.7778",
  storageKey: "wlpr_01ABC.../original.jpg",
  storageBucket: "wallpapers",
});
```

## BaseEventPublisher

Abstract class for publishing events with validation:

```typescript
import { BaseEventPublisher } from "@wallpaperdb/events";
import type { JetStreamClient } from "nats";
import { z } from "zod";

const MyEventSchema = z.object({
  id: z.string(),
  data: z.string(),
});

class MyEventPublisher extends BaseEventPublisher<typeof MyEventSchema> {
  constructor(js: JetStreamClient) {
    super({
      js,
      subject: "my.event.subject",
      schema: MyEventSchema,
      serviceName: "my-service",
    });
  }
}

// Usage
const publisher = new MyEventPublisher(jetstream);
await publisher.publish({ id: "123", data: "hello" });
```

### Features

- **Schema Validation** - Events are validated before publishing
- **Trace Context Propagation** - Automatically propagates OpenTelemetry trace context in NATS headers
- **Publish Acknowledgment** - Returns NATS publish acknowledgment for durability guarantees

## BaseEventConsumer

Abstract class for consuming events with automatic acknowledgment:

```typescript
import { BaseEventConsumer, type MessageContext } from "@wallpaperdb/events";
import type { JetStreamClient } from "nats";
import { z } from "zod";

const MyEventSchema = z.object({
  id: z.string(),
  data: z.string(),
});

class MyEventConsumer extends BaseEventConsumer<typeof MyEventSchema> {
  constructor(js: JetStreamClient) {
    super({
      js,
      stream: "MY_STREAM",
      consumer: "my-consumer",
      schema: MyEventSchema,
      serviceName: "my-service",
    });
  }

  protected async handleMessage(
    event: z.infer<typeof MyEventSchema>,
    context: MessageContext
  ): Promise<void> {
    console.log(`Processing event ${event.id}`);
    // Process the event...
  }
}

// Usage
const consumer = new MyEventConsumer(jetstream);
await consumer.start();

// Later...
await consumer.stop();
```

### Features

- **Schema Validation** - Events are validated before processing
- **Automatic Acknowledgment** - Messages are acked/nacked based on handler result
- **Trace Context Extraction** - Automatically extracts OpenTelemetry trace context from NATS headers
- **Error Handling** - Failed messages can be retried or dead-lettered

## License

Private - Anthropic
