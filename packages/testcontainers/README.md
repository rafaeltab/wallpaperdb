# @wallpaperdb/testcontainers

Custom Testcontainers implementations for WallpaperDB testing.

## Documentation

**Complete documentation:** [apps/docs/content/docs/packages/testcontainers.mdx](../../apps/docs/content/docs/packages/testcontainers.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Example

```typescript
import { createNatsContainer } from '@wallpaperdb/testcontainers/containers';

const natsContainer = await createNatsContainer({
  enableJetStream: true
});

const natsUrl = natsContainer.getConnectionUrl();

// Clean up
await natsContainer.stop();
```

## Available Containers

- **NATS**: NATS with JetStream support
- **Future**: PostgreSQL, MinIO, Redis

**See the [complete documentation](../../apps/docs/content/docs/packages/testcontainers.mdx) for detailed API reference.**
