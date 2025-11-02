# Ingestor Service Plan

## Overview

The ingestor service is the entry point for wallpapers into the system. Users upload wallpapers through this service, which then:
1. Validates the uploaded file (format, size, dimensions based on user limits)
2. Stores the wallpaper in MinIO
3. Records basic file metadata in PostgreSQL
4. Publishes an event to NATS for downstream processing
5. Returns upload confirmation to the user

**That's it.** This service does NOT manage titles, descriptions, tags, or any other metadata. It's purely a file ingestion service.

## Responsibilities

### Core Functions
- Accept multipart/form-data file uploads
- Validate file format, size, and dimensions (user-specific limits)
- Generate unique IDs for wallpapers
- Store original files in MinIO object storage
- Record basic file metadata in PostgreSQL (dimensions, mime type, file size, storage location)
- Emit events to NATS for downstream processing
- Handle upload failures gracefully with proper cleanup

### Explicitly Out of Scope (Handled by Other Services)
- **Metadata management** - Titles, descriptions, tags (separate metadata service)
- **Thumbnail generation** - Thumbnail extractor service
- **Quality analysis** - Quality enrichment service
- **Color extraction** - Color enrichment service
- **Image serving** - Media service
- **User authentication** - Gateway service

## Technology Stack

### Framework & Libraries
- **Web Framework**: Fastify (high-performance HTTP server)
- **File Upload**: `@fastify/multipart` (streaming multipart parser)
- **Validation**: Zod (runtime validation)
- **Error Handling**: RFC 7807 Problem Details format (custom implementation or `http-problem-details`)
- **ORM**: Drizzle ORM (type-safe PostgreSQL queries)
- **Database Migrations**: Drizzle Kit (`drizzle-kit`)
- **Object Storage**: AWS SDK v3 (`@aws-sdk/client-s3`) for MinIO
- **Message Queue**: `nats.js` (official NATS client)
- **Observability**: OpenTelemetry SDK for Node.js
- **Image Processing**: `sharp` (metadata extraction, validation, decompression bomb protection)
- **Video Processing**: `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` (video metadata extraction)
- **File Type Detection**: `file-type` (MIME type detection from content, not extension)
- **ID Generation**: `ulid` (Universally Unique Lexicographically Sortable Identifier)
- **Hashing**: Node.js crypto (SHA256 for content hashing)
- **Scheduling**: `node-cron` (for reconciliation scheduling)
- **Testing**: Vitest (test runner), Testcontainers (integration tests with real PostgreSQL/MinIO)

### Infrastructure Dependencies
- PostgreSQL (metadata storage)
- MinIO (object storage)
- NATS JetStream (event publishing)
- OTEL Collector (telemetry)

## API Design

### Endpoint: POST /upload

**Request**:
```typescript
Content-Type: multipart/form-data

Fields:
- file: File (required) - The wallpaper file
- userId: string (required) - User identifier (from auth context, injected by gateway)
```

**Response (Success)**:
```typescript
{
  "id": "wlpr_123abc...",
  "status": "processing",
  "uploadedAt": "2025-11-02T10:30:00Z",
  "fileType": "image",
  "mimeType": "image/jpeg",
  "width": 3840,
  "height": 2160,
  "fileSizeBytes": 5242880
}
```

**Response (Error - RFC 7807 Problem Details)**:
```typescript
// Invalid file format (400)
{
  "type": "https://wallpaperdb.example/problems/invalid-file-format",
  "title": "Invalid File Format",
  "status": 400,
  "detail": "Only JPEG, PNG, WebP, WebM, and MP4 formats are supported",
  "instance": "/upload",
  "receivedMimeType": "application/pdf"
}
```

```typescript
// File too large (413)
{
  "type": "https://wallpaperdb.example/problems/file-too-large",
  "title": "File Too Large",
  "status": 413,
  "detail": "File size exceeds your limit of 50MB for images",
  "instance": "/upload",
  "fileSizeBytes": 104857600,
  "maxFileSizeBytes": 52428800,
  "fileType": "image"
}
```

```typescript
// Dimensions out of bounds (400)
{
  "type": "https://wallpaperdb.example/problems/dimensions-out-of-bounds",
  "title": "Dimensions Out of Bounds",
  "status": 400,
  "detail": "Image dimensions must be between 1280x720 and 7680x4320",
  "instance": "/upload",
  "width": 800,
  "height": 600,
  "minWidth": 1280,
  "minHeight": 720,
  "maxWidth": 7680,
  "maxHeight": 4320
}
```

### Error Response Format (RFC 7807)

All error responses follow the **Problem Details for HTTP APIs** standard (RFC 7807):

**Standard fields**:
- `type`: URI identifying the problem type (used for documentation/lookup)
- `title`: Short, human-readable summary (consistent for this error type)
- `status`: HTTP status code
- `detail`: Human-readable explanation specific to this occurrence
- `instance`: URI of the endpoint that generated the error

**Extension fields**: Additional context-specific fields (e.g., `fileSizeBytes`, `width`, `maxWidth`)

**Content-Type**: `application/problem+json`

This standard format makes errors:
- Machine-readable (clients can parse `type` for error handling)
- Human-readable (`detail` provides context)
- Debuggable (extension fields provide all relevant data)
- Consistent across the API

## Validation Rules

### User-Based Validation Limits

Validation limits are **user-specific** to support future subscription tiers. The service uses a `ValidationLimitsService` interface:

```typescript
interface ValidationLimits {
  maxFileSizeImage: number;    // bytes
  maxFileSizeVideo: number;    // bytes
  minWidth: number;             // pixels
  minHeight: number;            // pixels
  maxWidth: number;             // pixels
  maxHeight: number;            // pixels
  allowedFormats: string[];     // MIME types
}

interface ValidationLimitsService {
  getLimitsForUser(userId: string): Promise<ValidationLimits>;
}
```

**Initial Implementation**: Simple in-code service returning default limits for all users:
```typescript
class DefaultValidationLimitsService implements ValidationLimitsService {
  async getLimitsForUser(userId: string): Promise<ValidationLimits> {
    return {
      maxFileSizeImage: 50 * 1024 * 1024,      // 50MB
      maxFileSizeVideo: 200 * 1024 * 1024,     // 200MB
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 7680,
      maxHeight: 4320,
      allowedFormats: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/webm',
        'video/mp4'
      ]
    };
  }
}
```

**Future**: Replace with database/API lookup for subscription-based limits.

### Default Validation Rules

**Supported Formats**:
- **Images**: JPEG, PNG, WebP
- **Videos**: WebM, MP4 (for animated/live wallpapers)

**Default Limits** (applied to all users initially):
- **Max file size**: 50MB for images, 200MB for videos
- **Min dimensions**: 1280x720 (HD)
- **Max dimensions**: 7680x4320 (8K)

## File Streaming Strategy

### Approach: Stream Directly to MinIO with Early Size Validation

**Problem**: Buffering entire file before validation could crash service or fill disk.

**Solution**: Validate size limits BEFORE accepting file, then stream directly to MinIO:

```typescript
// Configure Fastify multipart with size limits
fastify.register(multipart, {
  limits: {
    fileSize: async (request) => {
      const userId = request.userId; // From auth
      const limits = await validationLimitsService.getLimitsForUser(userId);
      // Return max based on what we can detect (conservative approach)
      return Math.max(limits.maxFileSizeImage, limits.maxFileSizeVideo);
    },
    files: 1 // Only one file per upload
  }
});

// Stream directly to MinIO without buffering
async function uploadToMinIO(stream, key, contentType) {
  return await s3Client.send(new PutObjectCommand({
    Bucket: 'wallpapers',
    Key: key,
    Body: stream, // Stream directly
    ContentType: contentType
  }));
}
```

**Benefits**:
- Memory efficient: No buffering entire file
- Fast: Streaming upload starts immediately
- Safe: Size validation happens during stream, rejects early
- Clean: If validation fails post-upload, we just delete from MinIO

**Tradeoff**: If file fails validation after upload (dimensions, content), must delete from MinIO. This is acceptable - happens rarely.

### Video Metadata Extraction

**Challenge**: Sharp only handles images, not videos.

**Solution**: Use `fluent-ffmpeg` for video metadata:

```typescript
import ffmpeg from 'fluent-ffmpeg';

async function getVideoMetadata(filePath: string) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      resolve({
        width: videoStream.width,
        height: videoStream.height,
        duration: metadata.format.duration,
        codec: videoStream.codec_name
      });
    });
  });
}
```

**Note**: FFmpeg requires file on disk, so for videos:
1. Stream to temporary file
2. Extract metadata
3. Upload to MinIO
4. Delete temp file

## Security Considerations

### 1. File Content Validation
- **MIME type detection**: Use `file-type` package to detect MIME from file content (not extension)
- **Malicious files**: Sharp's `limitInputPixels` option prevents decompression bombs
- **Filename sanitization**: Strip path traversal characters from `original_filename`

```typescript
import { fileTypeFromBuffer } from 'file-type';

// Detect actual MIME type from content
const buffer = await stream.read(4100); // Read first 4KB
const fileType = await fileTypeFromBuffer(buffer);

if (!allowedMimeTypes.includes(fileType.mime)) {
  throw new ValidationError('invalid-file-format');
}
```

### 2. Sharp Configuration
```typescript
sharp(input, {
  limitInputPixels: 268402689, // 16384 x 16384, prevents decompression bombs
  sequentialRead: true, // Memory efficient for large files
  failOnError: false // Don't crash on corrupt images
});
```

### 3. Filename Sanitization
```typescript
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Remove special chars
    .slice(0, 255); // Limit length
}
```

### 4. Rate Limiting
Implement per-user rate limiting to prevent abuse:
- Max 100 uploads per hour per user (configurable)
- Use Redis or in-memory store with sliding window

### 5. Virus Scanning (Future)
For production, consider integrating ClamAV:
- Scan files after upload
- Quarantine if virus detected
- Update virus definitions regularly

## Database Schema

### PostgreSQL ENUMs

Using ENUMs instead of TEXT for limited value sets saves storage and provides type safety:

```sql
-- File type: image or video
CREATE TYPE file_type AS ENUM ('image', 'video');

-- Upload state machine (for two-phase commit and reconciliation)
CREATE TYPE upload_state AS ENUM (
  'initiated',    -- Intent recorded, nothing uploaded yet
  'uploading',    -- MinIO upload in progress
  'stored',       -- In MinIO + DB, awaiting NATS publish
  'processing',   -- Event published, downstream processing
  'completed',    -- All downstream processing complete
  'failed'        -- Terminal failure state
);
```

**Storage comparison**:
- TEXT: 1 byte + string length (e.g., "processing" = 11 bytes)
- ENUM: 4 bytes (stored as integer internally)

For millions of wallpapers, this saves significant space.

### Table: `wallpapers`

```sql
CREATE TABLE wallpapers (
  id TEXT PRIMARY KEY,                    -- Format: wlpr_<ulid>
  user_id TEXT NOT NULL,                  -- Owner of the wallpaper

  -- Idempotency & deduplication
  content_hash TEXT,                      -- SHA256 of file content for dedup

  -- State machine for two-phase commit
  upload_state upload_state NOT NULL DEFAULT 'initiated',
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upload_attempts INTEGER NOT NULL DEFAULT 0,
  processing_error TEXT,                  -- Error message if upload_state = 'failed'

  -- File information (nullable until 'stored' state)
  file_type file_type,                    -- ENUM: 'image' or 'video'
  mime_type TEXT,                         -- e.g., 'image/jpeg', 'video/webm'
  file_size_bytes BIGINT,
  original_filename TEXT,

  -- Dimensions (nullable until 'stored' state)
  width INTEGER,
  height INTEGER,
  aspect_ratio DECIMAL(10, 4) GENERATED ALWAYS AS (
    CASE WHEN width IS NOT NULL AND height IS NOT NULL
    THEN width::decimal / height::decimal
    ELSE NULL END
  ) STORED,

  -- Storage (nullable until 'stored' state)
  storage_key TEXT,                       -- S3 object key: wlpr_<ulid>/original.ext
  storage_bucket TEXT DEFAULT 'wallpapers', -- S3 bucket name

  -- Timestamps
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_wallpapers_user_id ON wallpapers(user_id);
CREATE INDEX idx_wallpapers_upload_state ON wallpapers(upload_state);
CREATE INDEX idx_wallpapers_state_changed_at ON wallpapers(state_changed_at);
CREATE INDEX idx_wallpapers_uploaded_at ON wallpapers(uploaded_at DESC);
CREATE INDEX idx_wallpapers_file_type ON wallpapers(file_type) WHERE file_type IS NOT NULL;

-- Unique constraint for deduplication (per user)
CREATE UNIQUE INDEX idx_wallpapers_content_hash
  ON wallpapers(user_id, content_hash)
  WHERE content_hash IS NOT NULL AND upload_state IN ('stored', 'processing', 'completed');
```

**Notes**:
- `content_hash` enables idempotent uploads - same file won't be uploaded twice
- `upload_state` tracks the upload lifecycle for two-phase commit safety
- `state_changed_at` enables reconciliation to find stuck uploads
- Many fields nullable until 'stored' state (write-ahead intent pattern)
- `aspect_ratio` is a generated column with NULL handling
- Unique index on content_hash prevents duplicate uploads per user
- No title, description, or tags - those are managed by other services
- ENUMs provide type safety and save storage space

## MinIO Storage Structure

### Bucket Organization
```
wallpapers/
     wlpr_01HQ2X3Y4Z5A6B7C8D9E0F/
        original.jpg          # Original uploaded file
        metadata.json         # Basic file metadata (generated)
        (thumbnails added by thumbnail extractor service)
     wlpr_01HQ2X3Y4Z5A6B7C8D9E1G/
        original.webm
        metadata.json
  ...
```

### Object Naming Convention
- Use ULID for IDs (sortable, time-ordered, 26 characters)
- Prefix: `wlpr_` (wallpaper)
- Each wallpaper gets its own folder: `wlpr_<ulid>/`
- Original file stored as: `original.<extension>`

### MinIO Configuration
- Bucket: `wallpapers`
- Versioning: Disabled (saves storage)
- Lifecycle: Retain indefinitely (until explicit deletion)
- Access: Private (no public access, served via media service)

## NATS Event Publishing

### Event: `wallpaper.uploaded`

**Subject**: `wallpaper.uploaded`

**Payload**:
```typescript
{
  "eventId": "evt_123abc...",
  "eventType": "wallpaper.uploaded",
  "timestamp": "2025-11-02T10:30:00Z",
  "wallpaper": {
    "id": "wlpr_123abc...",
    "userId": "user_456def...",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "fileSizeBytes": 5242880,
    "width": 3840,
    "height": 2160,
    "aspectRatio": 1.7778,
    "storageKey": "wlpr_123abc.../original.jpg",
    "storageBucket": "wallpapers",
    "originalFilename": "my-wallpaper.jpg",
    "uploadedAt": "2025-11-02T10:30:00Z"
  }
}
```

**Note**: Only basic file metadata is included. No titles, tags, or user-provided metadata.

### NATS Stream Configuration
```typescript
{
  name: "WALLPAPERS",
  subjects: ["wallpaper.>"],
  retention: "interest",  // Messages deleted when all consumers ack
  storage: "file",
  maxAge: 7 * 24 * 60 * 60 * 1e9, // 7 days in nanoseconds
}
```

### Downstream Consumers
Services that consume `wallpaper.uploaded`:
- **Thumbnail extractor** - Generates thumbnails
- **Quality enrichment** - Analyzes image quality
- **Color enrichment** - Extracts dominant colors
- **OpenSearch indexer** - Indexes for search

## Reconciliation Service (Two-Phase Commit Safety)

### Purpose

The reconciliation service ensures **eventual consistency** and prevents data loss during bulk uploads or service crashes. It handles the two-phase commit problem by automatically detecting and fixing inconsistent states.

### When It Runs

- **Scheduled**: Every 5-10 minutes as a background job
- **On startup**: Quick reconciliation check on service boot
- **Manual**: Admin API endpoint to trigger reconciliation

### What It Fixes

1. **Stuck uploads**: Files stuck in 'uploading' state
2. **Missing events**: Files in 'stored' state that need NATS publishing
3. **Orphaned files**: Files in MinIO but DB record failed or is 'failed'
4. **Orphaned intents**: DB records in 'initiated' state that never progressed

### Implementation

```typescript
async function reconcile() {
  const now = new Date();
  const logger = getLogger('reconciliation');

  // 1. Fix stuck uploads (in 'uploading' for >10 minutes)
  const stuckUploading = await db.query.wallpapers.findMany({
    where: and(
      eq(wallpapers.uploadState, 'uploading'),
      lt(wallpapers.stateChangedAt, new Date(now.getTime() - 10 * 60 * 1000))
    )
  });

  for (const wallpaper of stuckUploading) {
    try {
      // Check if file actually exists in MinIO
      const exists = await minioClient.objectExists(
        wallpaper.storageBucket,
        wallpaper.storageKey
      );

      if (exists) {
        // Upload completed but DB not updated
        logger.info('Recovering stuck upload - file exists', { id: wallpaper.id });
        await db.update(wallpapers)
          .set({
            uploadState: 'stored',
            stateChangedAt: now
          })
          .where(eq(wallpapers.id, wallpaper.id));
      } else if (wallpaper.uploadAttempts < 3) {
        // Retry upload from original request (if we stored it)
        logger.warn('Upload failed, retrying', { id: wallpaper.id });
        await retryUpload(wallpaper.id);
      } else {
        // Give up after 3 attempts
        logger.error('Upload failed permanently', { id: wallpaper.id });
        await db.update(wallpapers)
          .set({
            uploadState: 'failed',
            processingError: 'Max retries exceeded'
          })
          .where(eq(wallpapers.id, wallpaper.id));
      }
    } catch (error) {
      logger.error('Reconciliation error for stuck upload', {
        id: wallpaper.id,
        error
      });
    }
  }

  // 2. Publish missing NATS events (in 'stored' for >5 minutes)
  const needsPublishing = await db.query.wallpapers.findMany({
    where: and(
      eq(wallpapers.uploadState, 'stored'),
      lt(wallpapers.stateChangedAt, new Date(now.getTime() - 5 * 60 * 1000))
    ),
    limit: 100 // Process in batches
  });

  for (const wallpaper of needsPublishing) {
    try {
      logger.info('Publishing missing event', { id: wallpaper.id });
      await publishEvent('wallpaper.uploaded', {
        eventId: generateUlid(),
        eventType: 'wallpaper.uploaded',
        timestamp: now.toISOString(),
        wallpaper: {
          id: wallpaper.id,
          userId: wallpaper.userId,
          fileType: wallpaper.fileType,
          mimeType: wallpaper.mimeType,
          fileSizeBytes: wallpaper.fileSizeBytes,
          width: wallpaper.width,
          height: wallpaper.height,
          aspectRatio: wallpaper.aspectRatio,
          storageKey: wallpaper.storageKey,
          storageBucket: wallpaper.storageBucket,
          originalFilename: wallpaper.originalFilename,
          uploadedAt: wallpaper.uploadedAt
        }
      });

      await db.update(wallpapers)
        .set({
          uploadState: 'processing',
          stateChangedAt: now
        })
        .where(eq(wallpapers.id, wallpaper.id));
    } catch (error) {
      logger.error('Failed to publish event during reconciliation', {
        id: wallpaper.id,
        error
      });
      // Will retry next reconciliation cycle
    }
  }

  // 3. Clean up orphaned intents (in 'initiated' for >1 hour)
  const orphanedIntents = await db.query.wallpapers.findMany({
    where: and(
      eq(wallpapers.uploadState, 'initiated'),
      lt(wallpapers.stateChangedAt, new Date(now.getTime() - 60 * 60 * 1000))
    )
  });

  if (orphanedIntents.length > 0) {
    logger.info('Cleaning up orphaned intents', { count: orphanedIntents.length });
    await db.delete(wallpapers)
      .where(inArray(wallpapers.id, orphanedIntents.map(w => w.id)));
  }

  // 4. Find orphaned MinIO objects (daily job, expensive)
  // This compares MinIO contents to DB and cleans up orphaned files
  // Run this less frequently (e.g., once per day at 3 AM)
  if (shouldRunOrphanedObjectCleanup()) {
    await cleanupOrphanedMinioObjects();
  }

  logger.info('Reconciliation complete', {
    stuckUploads: stuckUploading.length,
    missingEvents: needsPublishing.length,
    orphanedIntents: orphanedIntents.length
  });
}

async function cleanupOrphanedMinioObjects() {
  const logger = getLogger('reconciliation');

  // List all objects in MinIO
  const objects = await listAllMinioObjects('wallpapers');

  // Extract wallpaper IDs from object keys (format: wlpr_<ulid>/original.ext)
  const minioWallpaperIds = objects
    .map(obj => obj.Key.split('/')[0])
    .filter(key => key.startsWith('wlpr_'));

  // Query DB for these IDs
  const dbWallpapers = await db.query.wallpapers.findMany({
    where: inArray(wallpapers.id, minioWallpaperIds),
    columns: { id: true, uploadState: true }
  });

  const dbWallpaperIds = new Set(dbWallpapers.map(w => w.id));

  // Find orphaned objects (in MinIO but not in DB, or DB record is 'failed')
  const orphaned = minioWallpaperIds.filter(id => {
    const dbRecord = dbWallpapers.find(w => w.id === id);
    return !dbRecord || dbRecord.uploadState === 'failed';
  });

  // Delete orphaned objects
  for (const id of orphaned) {
    try {
      logger.info('Deleting orphaned MinIO object', { id });
      await deleteMinioFolder('wallpapers', `${id}/`);
    } catch (error) {
      logger.error('Failed to delete orphaned object', { id, error });
    }
  }

  logger.info('Orphaned object cleanup complete', {
    total: minioWallpaperIds.length,
    orphaned: orphaned.length
  });
}
```

### Scheduling

Use a simple cron-like scheduler or Node.js setInterval:

```typescript
// In main service startup
setInterval(async () => {
  try {
    await reconcile();
  } catch (error) {
    logger.error('Reconciliation failed', { error });
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Daily orphaned object cleanup (at 3 AM)
schedule('0 3 * * *', async () => {
  await cleanupOrphanedMinioObjects();
});
```

### Monitoring

Add metrics for reconciliation:
- `reconciliation_stuck_uploads_found` - Counter
- `reconciliation_missing_events_found` - Counter
- `reconciliation_orphaned_intents_cleaned` - Counter
- `reconciliation_duration_seconds` - Histogram

Alert if:
- Reconciliation finds >10 stuck uploads (indicates service issues)
- Reconciliation takes >30 seconds (indicates database/MinIO problems)

## Upload Flow (Write-Ahead Intent Pattern)

### Overview

The upload uses a **write-ahead intent pattern** for two-phase commit safety:
1. Hash file for idempotency
2. Check if already uploaded (deduplication)
3. Record intent in database (`initiated` state)
4. Upload to MinIO (`uploading` → `stored` state)
5. Publish to NATS (`processing` state)
6. Return success

If anything fails, reconciliation service will fix it automatically.

### Detailed Steps

### 1. Hash File for Idempotency
```typescript
// Hash the file content (first pass through stream)
const hash = crypto.createHash('sha256');
const chunks = [];

for await (const chunk of stream) {
  hash.update(chunk);
  chunks.push(chunk);
}

const contentHash = hash.digest('hex');
const fileBuffer = Buffer.concat(chunks); // Reassemble for processing
```

### 2. Check for Duplicate Upload
```typescript
// Check if this user already uploaded this exact file
const existing = await db.query.wallpapers.findFirst({
  where: and(
    eq(wallpapers.userId, userId),
    eq(wallpapers.contentHash, contentHash),
    inArray(wallpapers.uploadState, ['stored', 'processing', 'completed'])
  )
});

if (existing) {
  return {
    id: existing.id,
    status: 'already_uploaded',
    uploadedAt: existing.uploadedAt,
    // Return existing metadata
  };
}
```

### 3. Get User Limits & Basic Validation
```typescript
// Get user-specific validation limits
const limits = await validationLimitsService.getLimitsForUser(userId);

// Early file size check (from Content-Length header if available)
if (contentLength && contentLength > limits.maxFileSizeVideo) {
  throw new ValidationError('file-too-large');
}

// Detect MIME type from content
const fileType = await fileTypeFromBuffer(fileBuffer.slice(0, 4100));
if (!limits.allowedFormats.includes(fileType.mime)) {
  throw new ValidationError('invalid-file-format');
}
```

### 4. Record Intent (Write-Ahead)
```typescript
// Generate ID and record intent in database FIRST
const id = ulid();

await db.insert(wallpapers).values({
  id,
  userId,
  contentHash,
  uploadState: 'initiated',
  uploadAttempts: 0
});

// Now we have a record - anything that fails can be reconciled
```

### 5. Extract Metadata & Validate
```typescript
try {
  let metadata;

  if (fileType.mime.startsWith('image/')) {
    // Extract image metadata with Sharp
    metadata = await sharp(fileBuffer, {
      limitInputPixels: 268402689, // Prevent decompression bombs
      sequentialRead: true
    }).metadata();

    // Validate dimensions
    if (metadata.width < limits.minWidth || metadata.height < limits.minHeight) {
      throw new ValidationError('dimensions-out-of-bounds');
    }
    if (metadata.width > limits.maxWidth || metadata.height > limits.maxHeight) {
      throw new ValidationError('dimensions-out-of-bounds');
    }

  } else if (fileType.mime.startsWith('video/')) {
    // For videos, write to temp file for FFmpeg
    const tempPath = `/tmp/${id}.${fileType.ext}`;
    await fs.writeFile(tempPath, fileBuffer);

    try {
      metadata = await getVideoMetadata(tempPath);

      // Validate dimensions
      if (metadata.width < limits.minWidth || metadata.height < limits.minHeight) {
        throw new ValidationError('dimensions-out-of-bounds');
      }
      if (metadata.width > limits.maxWidth || metadata.height > limits.maxHeight) {
        throw new ValidationError('dimensions-out-of-bounds');
      }
    } finally {
      await fs.unlink(tempPath); // Clean up temp file
    }
  }

} catch (error) {
  // Mark as failed in DB
  await db.update(wallpapers)
    .set({
      uploadState: 'failed',
      processingError: error.message
    })
    .where(eq(wallpapers.id, id));

  throw error;
}
```

### 6. Update State to 'uploading' & Upload to MinIO
```typescript
// Update state before upload
await db.update(wallpapers)
  .set({
    uploadState: 'uploading',
    stateChangedAt: new Date()
  })
  .where(eq(wallpapers.id, id));

// Upload to MinIO
const storageKey = `${id}/original.${fileType.ext}`;

try {
  await s3Client.send(new PutObjectCommand({
    Bucket: 'wallpapers',
    Key: storageKey,
    Body: fileBuffer, // Or stream for larger files
    ContentType: fileType.mime,
    Metadata: {
      userId,
      uploadedAt: new Date().toISOString()
    }
  }));
} catch (error) {
  // MinIO upload failed, mark as failed
  await db.update(wallpapers)
    .set({
      uploadState: 'failed',
      processingError: `MinIO upload failed: ${error.message}`,
      uploadAttempts: sql`upload_attempts + 1`
    })
    .where(eq(wallpapers.id, id));

  throw new StorageError('storage-upload-failed');
}
```

### 7. Update to 'stored' with Full Metadata
```typescript
// Upload succeeded, update with full metadata
await db.update(wallpapers)
  .set({
    uploadState: 'stored',
    stateChangedAt: new Date(),
    fileType: fileType.mime.startsWith('image/') ? 'image' : 'video',
    mimeType: fileType.mime,
    fileSizeBytes: fileBuffer.length,
    width: metadata.width,
    height: metadata.height,
    storageKey,
    storageBucket: 'wallpapers',
    originalFilename: sanitizeFilename(originalFilename)
  })
  .where(eq(wallpapers.id, id));
```

### 8. Publish Event to NATS (Non-Blocking Failure)
```typescript
try {
  await publishEvent('wallpaper.uploaded', {
    eventId: ulid(),
    eventType: 'wallpaper.uploaded',
    timestamp: new Date().toISOString(),
    wallpaper: {
      id,
      userId,
      fileType: fileType.mime.startsWith('image/') ? 'image' : 'video',
      mimeType: fileType.mime,
      fileSizeBytes: fileBuffer.length,
      width: metadata.width,
      height: metadata.height,
      aspectRatio: metadata.width / metadata.height,
      storageKey,
      storageBucket: 'wallpapers',
      originalFilename: sanitizeFilename(originalFilename),
      uploadedAt: new Date().toISOString()
    }
  });

  // Event published successfully
  await db.update(wallpapers)
    .set({
      uploadState: 'processing',
      stateChangedAt: new Date()
    })
    .where(eq(wallpapers.id, id));

} catch (natsError) {
  // NATS publish failed, but file is uploaded
  // Don't fail the request - reconciliation will retry
  logger.warn('NATS publish failed, will be retried by reconciliation', {
    id,
    error: natsError
  });
  // Leave state as 'stored' - reconciliation will republish
}
```

### 9. Return Success Response
```typescript
return {
  id,
  status: 'processing', // Or 'stored' if NATS failed
  uploadedAt: new Date().toISOString(),
  fileType: fileType.mime.startsWith('image/') ? 'image' : 'video',
  mimeType: fileType.mime,
  width: metadata.width,
  height: metadata.height,
  fileSizeBytes: fileBuffer.length
};
```

### Benefits of This Flow

✅ **Idempotent**: Same file won't be uploaded twice (content hash deduplication)
✅ **Recoverable**: Service can crash at any point, reconciliation fixes it
✅ **Observable**: Query database to see upload state at any time
✅ **Bulk-friendly**: Can retry bulk uploads, skip already-uploaded files
✅ **Clean**: Automatic cleanup of failed uploads via reconciliation

## Error Handling

All errors are returned using RFC 7807 Problem Details format with `Content-Type: application/problem+json`.

### Error Categories

**Validation Errors (4xx)**:
- `invalid-file-format` (400) - Unsupported file type
- `file-too-large` (413) - File exceeds user's size limit
- `dimensions-out-of-bounds` (400) - Dimensions outside allowed range
- `missing-file` (400) - No file provided in request

**Storage Errors (5xx)**:
- `storage-upload-failed` (500) - MinIO upload failure
- `database-error` (500) - PostgreSQL insert failure
- `event-publishing-failed` (500) - NATS publish failure (partial success)

### Error Response Examples

**Validation Error**:
```typescript
{
  "type": "https://wallpaperdb.example/problems/file-too-large",
  "title": "File Too Large",
  "status": 413,
  "detail": "File size of 100MB exceeds your limit of 50MB for images",
  "instance": "/upload",
  "fileSizeBytes": 104857600,
  "maxFileSizeBytes": 52428800,
  "fileType": "image",
  "userId": "user_123abc"
}
```

**Storage Error**:
```typescript
{
  "type": "https://wallpaperdb.example/problems/storage-upload-failed",
  "title": "Storage Upload Failed",
  "status": 500,
  "detail": "Failed to upload file to object storage",
  "instance": "/upload",
  "traceId": "abc123def456"
}
```

### Error Recovery Strategies

1. **MinIO Upload Failure** (500):
   - Don't save to database
   - Return `storage-upload-failed` Problem Details immediately
   - Log error with trace context
   - No cleanup needed (nothing committed yet)

2. **Database Save Failure** (500):
   - Delete uploaded file from MinIO (cleanup)
   - Return `database-error` Problem Details
   - Log error with trace context
   - Ensure idempotency: if retry happens, cleanup old file first

3. **NATS Publish Failure** (Partial Success):
   - Wallpaper already saved in MinIO + PostgreSQL
   - Log warning with trace context (monitoring should alert)
   - Return **success** to user (file is uploaded and recorded)
   - Mark status as 'processing' in database
   - Background job or retry mechanism should republish event
   - **Rationale**: User shouldn't be penalized for messaging infrastructure issues

### Idempotency
- Use client-provided idempotency key (optional header)
- Store recent upload IDs in Redis/PostgreSQL
- If duplicate detected, return existing upload

## Observability

**All observability signals (metrics, logs, traces) are sent to the OTEL Collector**, which routes them to:
- **Prometheus** - Metrics
- **Loki** - Logs
- **Tempo** - Traces
- **Grafana** - Visualization

### Metrics (via OTEL → Prometheus)

Instrumented via OpenTelemetry SDK for Node.js:

- `ingestor_uploads_total{status="success|failure"}` - Counter
- `ingestor_upload_duration_seconds` - Histogram
- `ingestor_file_size_bytes{file_type="image|video"}` - Histogram
- `ingestor_validation_errors_total{reason}` - Counter
- `ingestor_storage_errors_total{type="minio|postgres|nats"}` - Counter

### Traces (via OTEL → Tempo)

Each upload creates a distributed trace with spans:

1. `POST /upload` - Root span (HTTP request)
2. `validation.get_limits` - Get user validation limits
3. `validation.file` - File validation
4. `storage.upload` - MinIO upload
5. `database.insert` - PostgreSQL insert
6. `events.publish` - NATS publish

Spans include attributes:
- `wallpaper.id`
- `user.id`
- `file.type`
- `file.size`
- `file.mime_type`

### Logs (via OTEL → Loki)

Structured JSON logs sent through OTEL:

```typescript
{
  "timestamp": "2025-11-02T10:30:00Z",
  "level": "info",
  "service": "ingestor",
  "traceId": "abc123...",
  "spanId": "def456...",
  "message": "Wallpaper uploaded successfully",
  "wallpaperId": "wlpr_123abc...",
  "userId": "user_456def...",
  "fileType": "image",
  "fileSize": 5242880,
  "mimeType": "image/jpeg",
  "durationMs": 234
}
```

All three signals are correlated via `traceId`, allowing you to:
- View logs for a specific trace in Grafana
- Jump from metrics spike to traces
- Debug errors with full context

## Configuration

### Environment Variables
```bash
# Server
PORT=3001
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/wallpaperdb

# MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=wallpapers
S3_REGION=us-east-1

# NATS
NATS_URL=nats://localhost:4222
NATS_STREAM=WALLPAPERS

# OTEL
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=ingestor
```

**Note**: Upload limits are user-specific and retrieved via `ValidationLimitsService`, not configured via environment variables.

## Operational Concerns

### Database Connection Pooling

PostgreSQL connections must be pooled properly for concurrent uploads:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Fail fast if can't get connection
});

const db = drizzle(pool);
```

**Recommended pool size**: Start with 20, monitor with metrics, adjust based on:
- Number of service instances
- Expected concurrent uploads
- PostgreSQL `max_connections` setting (default 100)

Formula: `pool_size_per_instance = max_connections / (num_instances * safety_factor)`

Example: 100 max connections / (3 instances * 1.5 safety factor) ≈ 22 per instance

### Graceful Shutdown

Handle SIGTERM/SIGINT to gracefully shutdown and avoid losing in-flight uploads:

```typescript
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // 1. Stop accepting new requests (close HTTP server, but finish existing)
  await fastify.close();
  logger.info('HTTP server closed, finishing existing requests...');

  // 2. Wait for in-flight uploads to complete (with timeout)
  await waitForInflightUploads(30000); // 30 second timeout

  // 3. Close database pool
  await pool.end();
  logger.info('Database pool closed');

  // 4. Close NATS connection
  await natsClient.close();
  logger.info('NATS connection closed');

  // 5. Close MinIO connections
  // S3 client doesn't need explicit closing

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Track in-flight uploads
let inflightUploads = 0;
let inflightResolve: (() => void) | null = null;

function trackUpload<T>(fn: () => Promise<T>): Promise<T> {
  inflightUploads++;
  return fn().finally(() => {
    inflightUploads--;
    if (inflightUploads === 0 && inflightResolve) {
      inflightResolve();
    }
  });
}

async function waitForInflightUploads(timeoutMs: number) {
  if (inflightUploads === 0) return;

  logger.info(`Waiting for ${inflightUploads} in-flight uploads...`);

  return Promise.race([
    new Promise<void>((resolve) => {
      inflightResolve = resolve;
    }),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn(`Timeout waiting for in-flight uploads, ${inflightUploads} remaining`);
        resolve();
      }, timeoutMs);
    })
  ]);
}
```

### Health Checks

Implement health check endpoint for orchestration (Kubernetes, Docker):

```typescript
fastify.get('/health', async (request, reply) => {
  if (isShuttingDown) {
    return reply.code(503).send({ status: 'shutting_down' });
  }

  const checks = {
    database: false,
    minio: false,
    nats: false
  };

  try {
    // Check database
    await db.execute(sql`SELECT 1`);
    checks.database = true;

    // Check MinIO
    await s3Client.send(new HeadBucketCommand({ Bucket: 'wallpapers' }));
    checks.minio = true;

    // Check NATS
    checks.nats = natsClient.info() !== null;

    if (checks.database && checks.minio && checks.nats) {
      return reply.code(200).send({ status: 'healthy', checks });
    } else {
      return reply.code(503).send({ status: 'unhealthy', checks });
    }
  } catch (error) {
    return reply.code(503).send({
      status: 'unhealthy',
      checks,
      error: error.message
    });
  }
});

// Readiness check (is service ready to accept traffic?)
fastify.get('/ready', async (request, reply) => {
  if (isShuttingDown || !natsClient || !db) {
    return reply.code(503).send({ ready: false });
  }
  return reply.code(200).send({ ready: true });
});
```

### CORS Configuration

If gateway is a separate service, configure CORS:

```typescript
import cors from '@fastify/cors';

fastify.register(cors, {
  origin: process.env.GATEWAY_URL || 'http://localhost:3000',
  methods: ['POST'], // Only POST for upload
  credentials: true,
  maxAge: 600 // Cache preflight for 10 minutes
});
```

**Note**: If gateway proxies requests, CORS may not be needed on ingestor.

### Rate Limiting

Protect against abuse with rate limiting:

```typescript
import rateLimit from '@fastify/rate-limit';

fastify.register(rateLimit, {
  max: 100, // 100 requests per window
  timeWindow: '1 hour',
  cache: 10000, // Keep track of 10k users
  keyGenerator: (request) => {
    // Rate limit per user
    return request.userId;
  },
  errorResponseBuilder: (request, context) => {
    return {
      type: 'https://wallpaperdb.example/problems/rate-limit-exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: `You have exceeded the upload limit of ${context.max} uploads per ${context.after}`,
      instance: '/upload',
      retryAfter: context.ttl
    };
  }
});
```

### Monitoring & Alerts

Key metrics to monitor and alert on:

**Upload Metrics**:
- `ingestor_uploads_total{status="success"}` - Should be high
- `ingestor_uploads_total{status="failure"}` - Alert if >5% of uploads
- `ingestor_upload_duration_seconds` - P95 should be <5s, P99 <10s

**Reconciliation Metrics**:
- `reconciliation_stuck_uploads_found` - Alert if >10 (indicates issues)
- `reconciliation_duration_seconds` - Alert if >30s (database/MinIO slow)

**Infrastructure Health**:
- Database connection pool utilization - Alert if >80%
- MinIO upload failures - Alert if >1% of uploads
- NATS publish failures - Alert if >5% (can recover, but indicates issues)

**Resource Metrics**:
- Memory usage - Alert if >80% of limit (possible leak)
- CPU usage - Alert if sustained >70% (need scaling)
- Disk usage for temp files - Alert if >90%

## Testing Strategy (TDD Approach)

We're using **Test-Driven Development** to ensure quality and get fast feedback. Tests are written BEFORE implementation.

### Integration Tests (Priority 1)
Write these FIRST, then implement features to make them pass:

- **Upload flow tests**:
  - Happy path: Upload valid image → verify stored in MinIO, PostgreSQL, NATS event published
  - Upload valid video → verify all steps
  - Upload with different image formats (JPEG, PNG, WebP)
  - Idempotency: Upload same file twice → should return existing, not create duplicate
  - Deduplication: Same content hash should be deduplicated

- **Validation tests**:
  - File too large → 413 error
  - Dimensions too small/large → 400 error
  - Invalid file format → 400 error
  - User-specific limits (when implemented)
  - Decompression bomb protection (Sharp limitInputPixels)

- **Error handling tests**:
  - MinIO failure → mark as failed in DB, no orphaned data
  - Database failure after MinIO upload → reconciliation cleans up
  - NATS failure → wallpaper still saved (partial success), state is 'stored'
  - Service crash during upload → reconciliation recovers

- **Reconciliation tests**:
  - Stuck 'uploading' state → reconciliation detects and fixes
  - Missing NATS events ('stored' state) → reconciliation publishes
  - Orphaned intents ('initiated' >1 hour) → reconciliation cleans up
  - Orphaned MinIO objects → reconciliation cleanup (daily job)

- **Infrastructure integration**:
  - Test PostgreSQL with real schema, ENUMs, and state machine
  - Test MinIO upload/retrieval
  - Test NATS event publishing with JetStream
  - Test content hash deduplication

### Unit Tests (Priority 2)
After integration tests, add unit tests for isolated logic:

- ValidationLimitsService implementation
- ID generation (ULID format validation)
- File type detection logic
- Error response formatting

### Load Tests (Future)
Once the service is stable:

- Concurrent uploads (50+ simultaneous)
- Large file handling (up to 200MB)
- Database connection pool under load

## Implementation Steps (TDD)

### Phase 1: Project Setup
1. **Initialize TypeScript project**
   - Setup package.json, tsconfig.json
   - Add dependencies: Fastify, Drizzle, Sharp, FFmpeg, AWS SDK, NATS, OTEL, file-type, ulid, node-cron
   - Configure build and dev scripts
   - Add Fastify plugins: multipart, cors, rate-limit

2. **Setup development infrastructure**
   - Ensure local infra (PostgreSQL, MinIO, NATS, OTEL) is running
   - Create database schema with ENUMs (upload_state, file_type)
   - Run Drizzle migrations: `npx drizzle-kit push:pg`
   - Create MinIO bucket
   - Create NATS JetStream stream

3. **Setup test infrastructure**
   - Install Vitest + Testcontainers
   - Setup test database with same schema
   - Generate test fixtures (sample images with Sharp, small videos)
   - Create test helpers for cleanup (MinIO, DB, NATS)
   - Setup test MinIO bucket

### Phase 2: Integration Tests (Write Tests FIRST)
4. **Write upload flow integration tests**
   - Test: Upload image → verify hash, MinIO, DB (state machine), NATS
   - Test: Upload video → verify FFmpeg extraction, storage, events
   - Test: Idempotency - same file twice returns existing
   - Test: Various image formats (JPEG, PNG, WebP)
   - **All tests will FAIL at this point** (expected)

5. **Write validation integration tests**
   - Test: File too large returns 413 RFC 7807 error
   - Test: Invalid dimensions return 400 with details
   - Test: Invalid format returns 400
   - Test: Decompression bomb protection (Sharp limitInputPixels)
   - Test: Filename sanitization
   - **All tests will FAIL at this point** (expected)

6. **Write error handling & reconciliation tests**
   - Test: MinIO failure → DB record marked 'failed'
   - Test: Database failure → no orphaned MinIO objects
   - Test: NATS failure → state stays 'stored', upload succeeds
   - Test: Reconciliation detects stuck 'uploading' state
   - Test: Reconciliation publishes missing events
   - Test: Reconciliation cleans up orphaned intents
   - **All tests will FAIL at this point** (expected)

### Phase 3: Core Implementation (Make Tests Pass)
7. **Implement database layer with state machine**
   - Drizzle schema with ENUMs (upload_state, file_type)
   - Connection pooling configuration (pg.Pool with max=20)
   - Insert/update operations for state transitions
   - Content hash unique index for deduplication
   - **Run tests → database tests should start passing**

8. **Implement ValidationLimitsService**
   - Interface: ValidationLimitsService
   - DefaultValidationLimitsService (returns hardcoded limits)
   - Make async for future extensibility
   - **Run tests → limit lookup tests pass**

9. **Implement file hashing & deduplication**
   - SHA256 hashing during stream read
   - Check for existing uploads by content_hash
   - Return existing upload if found
   - **Run tests → idempotency tests should pass**

10. **Implement file validation with security**
    - MIME type detection with `file-type` package
    - Sharp for image metadata (with limitInputPixels)
    - FFmpeg for video metadata (temp file approach)
    - Dimension validation against user limits
    - Filename sanitization (strip dangerous chars)
    - **Run tests → validation tests should pass**

11. **Implement write-ahead intent pattern**
    - Generate ULID
    - Insert DB record in 'initiated' state
    - Update to 'uploading' before MinIO upload
    - Update to 'stored' after successful upload
    - Update to 'processing' after NATS publish
    - **Run tests → state machine tests should pass**

12. **Implement MinIO integration with streaming**
    - S3 client configuration
    - Stream directly to MinIO (no buffering for large files)
    - Set content type and metadata
    - Error handling → mark DB as 'failed'
    - **Run tests → storage tests should pass**

13. **Implement NATS publishing (non-blocking failure)**
    - JetStream client setup
    - Event serialization (wallpaper.uploaded)
    - Publish with ack
    - On failure: log warning, leave state as 'stored' (reconciliation will retry)
    - **Run tests → event publishing tests should pass**

14. **Implement reconciliation service**
    - Background job (setInterval every 5 minutes)
    - Fix stuck uploads (check MinIO, update state)
    - Publish missing events (state='stored' >5 mins)
    - Clean orphaned intents (state='initiated' >1 hour)
    - Daily orphaned object cleanup (MinIO vs DB comparison)
    - **Run tests → ALL reconciliation tests should pass**

### Phase 4: Operational Features
15. **Implement RFC 7807 Problem Details errors**
    - Create error classes for each error type
    - Format errors as Problem Details JSON
    - Set Content-Type: application/problem+json
    - Include extension fields for context
    - **Run tests → error format tests should pass**

16. **Add operational endpoints**
    - Health check endpoint (/health)
    - Readiness check endpoint (/ready)
    - Admin reconciliation trigger endpoint
    - **Test with curl/Postman**

17. **Implement graceful shutdown**
    - SIGTERM/SIGINT handlers
    - Track in-flight uploads
    - Wait for completion (with timeout)
    - Close connections (DB pool, NATS, HTTP server)
    - **Test: send SIGTERM during upload**

18. **Add rate limiting & CORS**
    - Install @fastify/rate-limit
    - Configure per-user limits (100/hour)
    - Setup CORS if needed (gateway scenario)
    - Return 429 errors in Problem Details format
    - **Test: exceed rate limit**

### Phase 5: Observability
19. **Add OTEL instrumentation**
    - Configure OTEL SDK for Node.js
    - Auto-instrumentation for Fastify, PostgreSQL
    - Custom spans for upload flow steps
    - Metrics: upload counter, duration histogram
    - Structured logging with traceId
    - **Verify in Grafana/Tempo/Loki**

20. **Add reconciliation metrics**
    - Metrics for stuck uploads found
    - Metrics for missing events published
    - Metrics for orphaned intents cleaned
    - Alert rules in Grafana
    - **Verify metrics appear in Prometheus**

### Phase 6: Unit Tests & Refinement
21. **Add unit tests for isolated logic**
    - ValidationLimitsService
    - ULID generation format
    - Content hashing
    - Filename sanitization
    - Error response formatting
    - **All unit tests pass**

22. **Refactor with confidence**
    - Extract reusable functions
    - Clean up duplicate code
    - Improve error messages
    - **Run all tests → ensure nothing breaks**

### Phase 7: Documentation & Polish
23. **Document the service**
    - API documentation (OpenAPI/Swagger spec)
    - README with setup instructions
    - Architecture diagrams (upload flow, state machine)
    - Runbook for operations (how reconciliation works, troubleshooting)
    - Environment variable documentation

24. **Load testing**
    - Test concurrent uploads (50+ simultaneous)
    - Test large file handling (200MB videos)
    - Monitor database connection pool utilization
    - Monitor memory usage
    - Tune configuration based on results

## Benefits of TDD Approach

- **Fast feedback**: Integration tests run against real infrastructure, catching issues early
- **Confidence**: Refactor freely knowing tests will catch regressions
- **Living documentation**: Tests document expected behavior
- **Better design**: Writing tests first forces you to think about APIs and contracts

## Future Enhancements

- **Chunked uploads** - For very large files (>200MB)
- **Upload progress** - WebSocket for real-time progress
- **Duplicate detection** - Perceptual hashing to detect similar images
- **Auto-tagging** - ML-based tag suggestions
- **Virus scanning** - ClamAV integration for security
- **CDN integration** - Direct upload to CDN edge locations
- **Batch uploads** - Upload multiple files in one request
