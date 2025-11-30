# @wallpaperdb/test-utils

Composable test infrastructure using the TesterBuilder pattern.

## Documentation

**Complete documentation:** [apps/docs/content/docs/packages/test-utils.mdx](../../apps/docs/content/docs/packages/test-utils.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Example

```typescript
import { TesterBuilder } from '@wallpaperdb/test-utils';

const { app, db, cleanup } = await new TesterBuilder()
  .withPostgres()
  .withMinIO()
  .withNATS()
  .withRedis()
  .withMyServiceApp()
  .build();

try {
  // Run tests...
} finally {
  await cleanup();
}
```

## Features

- Composable test infrastructure builders
- Container reuse across test files
- Type-safe builder composition
- Automatic cleanup
- Support for integration and E2E tests

**See the [complete documentation](../../apps/docs/content/docs/packages/test-utils.mdx) for detailed API reference and examples.**
