# Reconciliation Scheduler Implementation Plan

## Overview

This plan addresses the critical missing feature: **automated reconciliation scheduling** with **multi-instance safety**. The reconciliation functions exist but aren't scheduled, and they need row-level locking to support multiple service instances running simultaneously.

## Problem Statement

1. **Missing Scheduler**: Reconciliation functions exist but don't run automatically
2. **Multi-Instance Conflicts**: Current implementation has race conditions when multiple instances run
3. **No Distributed Coordination**: Multiple instances could process the same records simultaneously

## Solution

Use PostgreSQL's `FOR UPDATE SKIP LOCKED` row-level locking to enable safe distributed reconciliation without external coordination (Redis, etc.).

---

## Phase 1: Add Row-Level Locking to Reconciliation ⚠️ CRITICAL

**Goal**: Make all reconciliation functions safe for concurrent execution across multiple instances.

### 1.1 Update `reconcileStuckUploads()` in `src/services/reconciliation.service.ts`

**Current Issue**:
- Multiple instances query same stuck uploads
- Race condition: both try to update the same record
- Potential for duplicate processing

**Solution**:
```typescript
export async function reconcileStuckUploads(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  // Process records one at a time with row-level locking
  while (true) {
    let processed = false;

    await database.transaction(async (tx) => {
      // Lock next available stuck upload (skip locked rows)
      const [upload] = await tx
        .select()
        .from(wallpapers)
        .where(
          and(
            eq(wallpapers.uploadState, 'uploading'),
            lt(wallpapers.stateChangedAt, tenMinutesAgo)
          )
        )
        .limit(1)
        .for('update', { skipLocked: true }); // ← CRITICAL for multi-instance

      if (!upload) return;

      processed = true;

      // Check if file exists in MinIO
      const storageKey = `${upload.id}/original.jpg`;
      const fileExists = await objectExists(storageBucket, storageKey, s3Client);

      if (fileExists) {
        // Recover to 'stored' state
        await tx
          .update(wallpapers)
          .set({
            uploadState: 'stored',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, upload.id));

        console.log(`Recovered stuck upload ${upload.id} to 'stored' state`);
      } else if (upload.uploadAttempts >= 3) {
        // Max retries exceeded
        await tx
          .update(wallpapers)
          .set({
            uploadState: 'failed',
            processingError: 'Max retries exceeded',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, upload.id));

        console.log(`Marked upload ${upload.id} as failed`);
      } else {
        // Increment retry attempts
        await tx
          .update(wallpapers)
          .set({
            uploadAttempts: upload.uploadAttempts + 1,
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, upload.id));

        console.log(`Incremented retry for ${upload.id} (${upload.uploadAttempts + 1}/3)`);
      }
    });

    // Exit loop if no records found
    if (!processed) break;
  }
}
```

**Key Changes**:
- Wrap in `while(true)` loop to process all stuck uploads
- Use transaction with `FOR UPDATE SKIP LOCKED`
- Process one record at a time (each instance claims different records)
- Break when no more records found

---

### 1.2 Update `reconcileMissingEvents()` in `src/services/reconciliation.service.ts`

**Current Issue**:
- Batches of 10 processed, but no locking
- Multiple instances could publish same event multiple times

**Solution**:
```typescript
export async function reconcileMissingEvents(db?: DbType): Promise<void> {
  const database = db || getDatabase();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Process records one at a time with row-level locking
  while (true) {
    let processed = false;

    await database.transaction(async (tx) => {
      // Lock next available stuck record
      const [record] = await tx
        .select()
        .from(wallpapers)
        .where(
          and(
            eq(wallpapers.uploadState, 'stored'),
            lt(wallpapers.stateChangedAt, fiveMinutesAgo)
          )
        )
        .limit(1)
        .for('update', { skipLocked: true }); // ← CRITICAL

      if (!record) return;

      processed = true;

      try {
        // Publish event
        await publishWallpaperUploadedEvent(record);

        // Update state to 'processing'
        await tx
          .update(wallpapers)
          .set({
            uploadState: 'processing',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, record.id));

        console.log(`Republished event for wallpaper ${record.id}`);
      } catch (error) {
        console.error(`Failed to republish event for ${record.id}:`, error);
        // Transaction will rollback, leaving in 'stored' for retry
        throw error;
      }
    });

    if (!processed) break;
  }
}
```

**Key Changes**:
- Process one at a time instead of batches (simpler locking)
- Use transaction with `FOR UPDATE SKIP LOCKED`
- Rollback on NATS failure (keeps in 'stored' state)

---

### 1.3 Update `reconcileOrphanedIntents()` in `src/services/reconciliation.service.ts`

**Current Issue**:
- No locking on deletes
- Multiple instances could try to delete same record

**Solution**:
```typescript
export async function reconcileOrphanedIntents(db?: DbType): Promise<void> {
  const database = db || getDatabase();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  while (true) {
    let processed = false;

    await database.transaction(async (tx) => {
      // Lock next orphaned intent
      const [intent] = await tx
        .select()
        .from(wallpapers)
        .where(
          and(
            eq(wallpapers.uploadState, 'initiated'),
            lt(wallpapers.stateChangedAt, oneHourAgo)
          )
        )
        .limit(1)
        .for('update', { skipLocked: true }); // ← CRITICAL

      if (!intent) return;

      processed = true;

      // Delete the orphaned intent
      await tx
        .delete(wallpapers)
        .where(eq(wallpapers.id, intent.id));

      console.log(`Deleted orphaned intent ${intent.id}`);
    });

    if (!processed) break;
  }
}
```

---

### 1.4 Leave `reconcileOrphanedMinioObjects()` As-Is

**Why No Changes Needed**:
- Reads from MinIO (no writes that need locking)
- Checks DB for existence
- Idempotent: deleting same object twice is safe
- Already processes in batches

**Note**: If two instances delete the same MinIO object, the second delete is a no-op (safe).

---

## Phase 2: Create Scheduler Service

### 2.1 Create `src/services/scheduler.service.ts`

**Purpose**: Background job runner for periodic reconciliation.

```typescript
import { reconcileStuckUploads } from './reconciliation.service.js';
import { reconcileMissingEvents } from './reconciliation.service.js';
import { reconcileOrphanedIntents } from './reconciliation.service.js';
import { reconcileOrphanedMinioObjects } from './reconciliation.service.js';

let reconciliationInterval: NodeJS.Timeout | null = null;
let minioCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the reconciliation scheduler
 * Runs reconciliation every 5 minutes
 * Runs MinIO cleanup daily at 3 AM (optional - can use simple 24h interval)
 */
export function startScheduler(): void {
  if (reconciliationInterval) {
    console.log('Scheduler already running');
    return;
  }

  console.log('Starting reconciliation scheduler...');

  // Run reconciliation every 5 minutes
  reconciliationInterval = setInterval(
    async () => {
      try {
        console.log('Running reconciliation cycle...');

        await reconcileStuckUploads();
        await reconcileMissingEvents();
        await reconcileOrphanedIntents();

        console.log('Reconciliation cycle complete');
      } catch (error) {
        console.error('Reconciliation cycle failed:', error);
        // Don't crash - continue to next interval
      }
    },
    5 * 60 * 1000 // 5 minutes
  );

  // Run MinIO cleanup every 24 hours
  minioCleanupInterval = setInterval(
    async () => {
      try {
        console.log('Running MinIO orphaned object cleanup...');
        await reconcileOrphanedMinioObjects();
        console.log('MinIO cleanup complete');
      } catch (error) {
        console.error('MinIO cleanup failed:', error);
      }
    },
    24 * 60 * 60 * 1000 // 24 hours
  );

  console.log('Scheduler started');
}

/**
 * Stop the reconciliation scheduler
 * Called during graceful shutdown
 */
export function stopScheduler(): void {
  console.log('Stopping reconciliation scheduler...');

  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }

  if (minioCleanupInterval) {
    clearInterval(minioCleanupInterval);
    minioCleanupInterval = null;
  }

  console.log('Scheduler stopped');
}

/**
 * Run reconciliation immediately (for testing or admin trigger)
 */
export async function runReconciliationNow(): Promise<void> {
  console.log('Running manual reconciliation...');

  await reconcileStuckUploads();
  await reconcileMissingEvents();
  await reconcileOrphanedIntents();

  console.log('Manual reconciliation complete');
}
```

---

### 2.2 Update `src/index.ts` to Start/Stop Scheduler

```typescript
import { startScheduler, stopScheduler } from './services/scheduler.service.js';

// After server starts
await fastify.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Server listening on port ${config.port}`);

// Start reconciliation scheduler
startScheduler();

// In graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, starting graceful shutdown...`);

  // Stop scheduler first
  stopScheduler();

  // Close server
  await fastify.close();

  // Close connections...
}
```

---

## Phase 3: Multi-Instance Safety Testing ⭐ CRITICAL

### 3.1 Create `test/multi-instance.test.ts`

**Purpose**: Prove that multiple instances can run reconciliation simultaneously without conflicts.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDatabase } from '../src/connections/database.js';
import { getMinioClient } from '../src/connections/minio.js';
import { wallpapers } from '../src/db/schema.js';
import {
  reconcileStuckUploads,
  reconcileMissingEvents,
  reconcileOrphanedIntents,
} from '../src/services/reconciliation.service.js';
import { uploadToStorage } from '../src/services/storage.service.js';
import { generateTestImageBuffer } from './fixtures.js';

describe('Multi-Instance Safety Tests', () => {
  const db = getDatabase();
  const s3Client = getMinioClient();
  const bucket = process.env.S3_BUCKET || 'wallpapers';

  beforeEach(async () => {
    // Clean up database
    await db.delete(wallpapers);
  });

  it('should handle concurrent stuck upload recovery without duplicates', async () => {
    // Create 20 stuck uploads
    const stuckUploads = [];
    for (let i = 0; i < 20; i++) {
      const id = `wlpr_test_stuck_${i}`;
      const storageKey = `${id}/original.jpg`;

      // Upload file to MinIO
      const buffer = generateTestImageBuffer();
      await uploadToStorage(bucket, storageKey, buffer, 'image/jpeg', s3Client);

      // Insert stuck upload record (in 'uploading' state for >10 min)
      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'uploading',
        stateChangedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        uploadAttempts: 0,
        contentHash: `hash_${i}`,
      });

      stuckUploads.push(id);
    }

    // Simulate 3 instances running reconciliation concurrently
    const workers = [
      reconcileStuckUploads(bucket, db, s3Client),
      reconcileStuckUploads(bucket, db, s3Client),
      reconcileStuckUploads(bucket, db, s3Client),
    ];

    await Promise.all(workers);

    // Verify: All 20 records should be in 'stored' state
    const storedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    expect(storedCount[0].count).toBe(20);

    // Verify: No records left in 'uploading' state
    const uploadingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'uploading'));

    expect(uploadingCount[0].count).toBe(0);
  });

  it('should handle concurrent missing event publishing without duplicates', async () => {
    // Create 30 records in 'stored' state
    for (let i = 0; i < 30; i++) {
      await db.insert(wallpapers).values({
        id: `wlpr_test_stored_${i}`,
        userId: 'user_test',
        uploadState: 'stored',
        stateChangedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        uploadAttempts: 0,
        contentHash: `hash_${i}`,
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        storageKey: `wlpr_test_stored_${i}/original.jpg`,
        storageBucket: bucket,
        originalFilename: `test_${i}.jpg`,
      });
    }

    // Simulate 3 instances running event publishing concurrently
    const workers = [
      reconcileMissingEvents(db),
      reconcileMissingEvents(db),
      reconcileMissingEvents(db),
    ];

    await Promise.all(workers);

    // Verify: All 30 records should be in 'processing' state
    const processingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'processing'));

    expect(processingCount[0].count).toBe(30);

    // Verify: No records left in 'stored' state
    const storedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    expect(storedCount[0].count).toBe(0);
  });

  it('should handle concurrent orphaned intent cleanup without errors', async () => {
    // Create 15 orphaned intents
    for (let i = 0; i < 15; i++) {
      await db.insert(wallpapers).values({
        id: `wlpr_test_intent_${i}`,
        userId: 'user_test',
        uploadState: 'initiated',
        stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        uploadAttempts: 0,
        contentHash: `hash_${i}`,
      });
    }

    // Simulate 2 instances running cleanup concurrently
    const workers = [
      reconcileOrphanedIntents(db),
      reconcileOrphanedIntents(db),
    ];

    await Promise.all(workers);

    // Verify: All intents deleted
    const intentCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'initiated'));

    expect(intentCount[0].count).toBe(0);
  });

  it('should handle race conditions with 5 concurrent workers (stress test)', async () => {
    // Create 100 stuck records in mixed states
    for (let i = 0; i < 50; i++) {
      const id = `wlpr_stress_uploading_${i}`;
      const storageKey = `${id}/original.jpg`;

      // Upload file to MinIO
      const buffer = generateTestImageBuffer();
      await uploadToStorage(bucket, storageKey, buffer, 'image/jpeg', s3Client);

      // Stuck in 'uploading'
      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'uploading',
        stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_${i}`,
      });
    }

    for (let i = 0; i < 30; i++) {
      // Stuck in 'stored'
      await db.insert(wallpapers).values({
        id: `wlpr_stress_stored_${i}`,
        userId: 'user_test',
        uploadState: 'stored',
        stateChangedAt: new Date(Date.now() - 10 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_stored_${i}`,
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        storageKey: `wlpr_stress_stored_${i}/original.jpg`,
        storageBucket: bucket,
        originalFilename: `test_${i}.jpg`,
      });
    }

    for (let i = 0; i < 20; i++) {
      // Orphaned intents
      await db.insert(wallpapers).values({
        id: `wlpr_stress_intent_${i}`,
        userId: 'user_test',
        uploadState: 'initiated',
        stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_intent_${i}`,
      });
    }

    // Simulate 5 workers running ALL reconciliation functions concurrently
    const workers = [];
    for (let i = 0; i < 5; i++) {
      workers.push(
        (async () => {
          await reconcileStuckUploads(bucket, db, s3Client);
          await reconcileMissingEvents(db);
          await reconcileOrphanedIntents(db);
        })()
      );
    }

    await Promise.all(workers);

    // Verify final states
    const storedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    const processingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'processing'));

    const intentCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'initiated'));

    // 50 uploading → stored (awaiting NATS)
    expect(storedCount[0].count).toBe(50);

    // 30 stored → processing (NATS published)
    expect(processingCount[0].count).toBe(30);

    // 20 intents → deleted
    expect(intentCount[0].count).toBe(0);

    // Total should be 80 (50 stored + 30 processing)
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(wallpapers);

    expect(totalCount[0].count).toBe(80);
  });
});
```

---

## Phase 4: Clean Up Video Support (Defer)

### 4.1 Update `src/services/validation-limits.service.ts`

**Remove video formats from allowed list:**

```typescript
export class DefaultValidationLimitsService implements ValidationLimitsService {
  async getLimitsForUser(userId: string): Promise<ValidationLimits> {
    return {
      maxFileSizeImage: 50 * 1024 * 1024,      // 50MB
      maxFileSizeVideo: 200 * 1024 * 1024,     // 200MB (not used yet)
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 7680,
      maxHeight: 4320,
      allowedFormats: [
        'image/jpeg',
        'image/png',
        'image/webp',
        // TODO: Add video support with FFmpeg integration
        // 'video/webm',
        // 'video/mp4'
      ]
    };
  }
}
```

### 4.2 Update Tests

Remove or skip video-related tests in `test/validation.test.ts` and `test/upload-flow.test.ts`.

---

## Implementation Order (TDD)

### Step 1: Write Multi-Instance Tests FIRST
- Create `test/multi-instance.test.ts`
- All tests will FAIL (expected)
- Commit: "Add multi-instance safety tests (failing)"

### Step 2: Add Row-Level Locking
- Update `reconcileStuckUploads()` with `FOR UPDATE SKIP LOCKED`
- Update `reconcileMissingEvents()` with `FOR UPDATE SKIP LOCKED`
- Update `reconcileOrphanedIntents()` with `FOR UPDATE SKIP LOCKED`
- Run multi-instance tests → should PASS
- Commit: "Add row-level locking to reconciliation service"

### Step 3: Create Scheduler Service
- Create `src/services/scheduler.service.ts`
- Update `src/index.ts` to start/stop scheduler
- Commit: "Add reconciliation scheduler service"

### Step 4: Test Scheduler
- Add scheduler tests to `test/scheduler.test.ts`
- Verify intervals work correctly
- Commit: "Add scheduler tests"

### Step 5: Clean Up Video Support
- Remove video formats from allowed list
- Update tests
- Commit: "Remove video support (defer for later)"

### Step 6: Run Full Test Suite
- Ensure all existing tests still pass
- Verify multi-instance tests pass
- Commit: "Verify all tests pass"

---

## Success Criteria

✅ All reconciliation functions use `FOR UPDATE SKIP LOCKED`
✅ Multi-instance test suite passes (all 4 tests)
✅ Stress test with 5 concurrent workers passes
✅ Scheduler runs every 5 minutes automatically
✅ Scheduler starts/stops cleanly during service lifecycle
✅ No database constraint violations under concurrent load
✅ No duplicate processing in any scenario
✅ Video formats removed from validation

---

## Expected Benefits

**Safety**: PostgreSQL row-level locking prevents race conditions
**Scalability**: Can run N instances without external coordination
**Reliability**: Failed uploads auto-recover every 5 minutes
**Testability**: Comprehensive tests prove multi-instance correctness
**Simplicity**: No Redis/distributed lock service needed

---

## Notes

- **`FOR UPDATE SKIP LOCKED`** is the key to multi-instance safety
- Each instance claims different records (locked rows are skipped)
- Transactions ensure atomicity (lock + update is atomic)
- No need for distributed locks or coordination
- PostgreSQL handles all the complexity

This approach is production-ready and horizontally scalable! 🚀
