# Replace console.log with Structured Logging

> **Status:** Planned  
> **Priority:** Medium  
> **Estimated Effort:** 1 day  

## Overview

Replace all `console.log/error` with Pino structured logging.

## Locations to Fix

```typescript
// apps/ingestor/src/services/storage.service.ts:78
console.error('MinIO upload failed:', error);

// apps/ingestor/src/services/storage.service.ts:142
console.error('Failed to delete from MinIO:', error);

// apps/ingestor/src/services/reconciliation/base-reconciliation.service.ts:136
console.error(`Error in ${operationName}:`, error);
```

## Solution

Inject `Logger` service everywhere:

```typescript
@injectable()
export class StorageService {
  constructor(
    @inject('Logger') private readonly logger: Logger
  ) {}
  
  async upload(...) {
    try {
      // ...
    } catch (error) {
      this.logger.error('MinIO upload failed', {
        wallpaperId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorageUploadFailedError();
    }
  }
}
```

## Acceptance Criteria

- [ ] Zero console.log/error in production code
- [ ] All logging uses injected Logger
- [ ] Logs include structured context
- [ ] Trace context propagates
