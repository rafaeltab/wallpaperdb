# @wallpaperdb/events

Event schemas and pub/sub abstractions for inter-service communication.

## Documentation

**Complete documentation:** [apps/docs/content/docs/packages/events.mdx](../../apps/docs/content/docs/packages/events.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Example

```typescript
import { BaseEventPublisher, WallpaperUploadedEventSchema } from '@wallpaperdb/events';

// Publish events
class MyPublisher extends BaseEventPublisher<typeof WallpaperUploadedEventSchema> {
  constructor(js: JetStreamClient) {
    super({
      js,
      subject: 'wallpaper.uploaded',
      schema: WallpaperUploadedEventSchema,
      serviceName: 'my-service',
    });
  }
}

// Consume events
class MyConsumer extends BaseEventConsumer<typeof WallpaperUploadedEventSchema> {
  protected async handleMessage(event, context) {
    // Process event
  }
}
```

## Features

- Event schemas with Zod validation
- BaseEventPublisher with trace context propagation
- BaseEventConsumer with automatic acknowledgment
- Type-safe event handling

**See the [complete documentation](../../apps/docs/content/docs/packages/events.mdx) for detailed API reference.**
