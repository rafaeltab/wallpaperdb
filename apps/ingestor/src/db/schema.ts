import {
  pgTable,
  text,
  bigint,
  integer,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  decimal,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ENUMs for type safety and storage efficiency
export const fileTypeEnum = pgEnum('file_type', ['image', 'video']);

export const uploadStateEnum = pgEnum('upload_state', [
  'initiated', // Intent recorded, nothing uploaded yet
  'uploading', // MinIO upload in progress
  'stored', // In MinIO + DB, awaiting NATS publish
  'processing', // Event published, downstream processing
  'completed', // All downstream processing complete
  'failed', // Terminal failure state
]);

// Wallpapers table - stores file metadata and upload state
export const wallpapers = pgTable(
  'wallpapers',
  {
    id: text('id').primaryKey(), // Format: wlpr_<ulid>
    userId: text('user_id').notNull(),

    // Idempotency & deduplication
    contentHash: text('content_hash'), // SHA256 of file content for dedup

    // State machine for two-phase commit
    uploadState: uploadStateEnum('upload_state').notNull().default('initiated'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    uploadAttempts: integer('upload_attempts').notNull().default(0),
    processingError: text('processing_error'), // Error message if upload_state = 'failed'

    // File information (nullable until 'stored' state)
    fileType: fileTypeEnum('file_type'), // ENUM: 'image' or 'video'
    mimeType: text('mime_type'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    originalFilename: text('original_filename'),

    // Dimensions (nullable until 'stored' state)
    width: integer('width'),
    height: integer('height'),
    // Aspect ratio is calculated as a generated column
    aspectRatio: decimal('aspect_ratio', { precision: 10, scale: 4 }),

    // Storage (nullable until 'stored' state)
    storageKey: text('storage_key'), // S3 object key: wlpr_<ulid>/original.ext
    storageBucket: text('storage_bucket').default('wallpapers'),

    // Timestamps
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Indexes for performance
    index('idx_wallpapers_user_id').on(table.userId),
    index('idx_wallpapers_upload_state').on(table.uploadState),
    index('idx_wallpapers_state_changed_at').on(table.stateChangedAt),
    index('idx_wallpapers_uploaded_at').on(table.uploadedAt),

    // Unique constraint for deduplication (per user)
    // Only enforce uniqueness for successfully stored/processing/completed uploads
    uniqueIndex('idx_wallpapers_content_hash')
      .on(table.userId, table.contentHash)
      .where(
        sql`${table.contentHash} IS NOT NULL AND ${table.uploadState} IN ('stored', 'processing', 'completed')`
      ),
  ]
);

// Type exports for TypeScript
export type Wallpaper = typeof wallpapers.$inferSelect;
export type NewWallpaper = typeof wallpapers.$inferInsert;
export type UploadState = (typeof uploadStateEnum.enumValues)[number];
export type FileType = (typeof fileTypeEnum.enumValues)[number];
