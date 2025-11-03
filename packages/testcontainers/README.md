# @wallpaperdb/testcontainers

Shared testcontainer utilities for WallpaperDB tests.

## Overview

This package provides reusable testcontainer setups for integration testing across all WallpaperDB services. It ensures consistent test infrastructure and eliminates duplication.

## Installation

This is a workspace package. Add it to your app's `package.json`:

```json
{
  "devDependencies": {
    "@wallpaperdb/testcontainers": "workspace:*"
  }
}
```

## Usage

### NATS Container

Create a NATS testcontainer with JetStream support:

```typescript
import { createNatsContainer } from '@wallpaperdb/testcontainers/containers';

// In your test setup
const natsContainer = await createNatsContainer({
  enableJetStream: true
});

// Get connection URL
const natsUrl = natsContainer.getConnectionUrl();

// Use with NATS client
import { connect } from 'nats';
const natsClient = await connect({ servers: natsUrl });

// Clean up after tests
await natsContainer.stop();
```

### Features

- **Proper wait strategies**: Containers wait for services to be fully ready before tests begin
- **Type-safe APIs**: Full TypeScript support with exported types
- **Flexible configuration**: Customize containers for different test scenarios
- **Performance optimized**: Eliminates connection delays and timeouts

## Available Containers

### NATS

- **Function**: `createNatsContainer(options?)`
- **Options**:
  - `image` (string): Docker image to use (default: 'nats:2.10-alpine')
  - `enableJetStream` (boolean): Enable JetStream support (default: true)
  - `additionalArgs` (string[]): Additional CLI arguments
- **Returns**: `StartedNatsContainer` with `getConnectionUrl()` method

## Development

Build the package:

```bash
pnpm --filter @wallpaperdb/testcontainers build
```

Watch mode for development:

```bash
pnpm --filter @wallpaperdb/testcontainers dev
```

## Future Additions

This package will be expanded to include:

- PostgreSQL container setup with schema initialization
- MinIO/S3 container setup with bucket management
- Test helpers and cleanup utilities
- Test fixtures and data generators
