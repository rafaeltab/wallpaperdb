import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Wallpapers table - stores metadata from wallpaper.uploaded events
 * This is the media service's own copy of wallpaper metadata
 */
export const wallpapers = pgTable('wallpapers', {
  // Primary key - wallpaper ID from event (e.g., wlpr_01ABC...)
  id: text('id').primaryKey(),

  // Storage information
  storageBucket: text('storage_bucket').notNull(),
  storageKey: text('storage_key').notNull(),

  // File metadata
  mimeType: text('mime_type').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Variants table - stores information about pre-generated size variants
 * Will be populated by a separate Variant Generator service
 */
export const variants = pgTable(
  'variants',
  {
    // Primary key - variant ID (e.g., var_01ABC...)
    id: text('id').primaryKey(),

    // Reference to parent wallpaper
    wallpaperId: text('wallpaper_id').notNull(),

    // Legacy variants used the parent bucket; new projections keep the asset location.
    storageBucket: text('storage_bucket'),
    storageKey: text('storage_key').notNull(),

    // Variant dimensions
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Composite index for efficient variant selection queries
    // Used by VariantRepository.findSmallestSuitable() to find variants by dimensions
    variantSelectionIdx: index('idx_variants_selection').on(
      table.wallpaperId,
      table.width,
      table.height
    ),
  })
);

// Type exports for use in services
export type Wallpaper = typeof wallpapers.$inferSelect;
export type NewWallpaper = typeof wallpapers.$inferInsert;
export type Variant = typeof variants.$inferSelect;
export type NewVariant = typeof variants.$inferInsert;

export const profilePictureAssets = pgTable('profile_picture_assets', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull(),
  storageBucket: text('storage_bucket').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const profilePictureHeads = pgTable(
  'profile_picture_heads',
  {
    profileId: text('profile_id').primaryKey(),
    version: integer('version').notNull(),
    // Snapshots may arrive before the event containing this asset's metadata.
    pictureId: text('picture_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('profile_picture_heads_picture_id_idx').on(table.pictureId)]
);

export type ProfilePictureAsset = typeof profilePictureAssets.$inferSelect;
export type NewProfilePictureAsset = typeof profilePictureAssets.$inferInsert;
export type ProfilePictureHead = typeof profilePictureHeads.$inferSelect;
export type NewProfilePictureHead = typeof profilePictureHeads.$inferInsert;

/** Occurrence and projection effects share one transaction. */
export const catalogProcessed = pgTable(
  'catalog_processed',
  {
    source: text('source').notNull(),
    occurrenceId: text('occurrence_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.source, table.occurrenceId] })]
);

export const catalogOutbox = pgTable('catalog_outbox', {
  id: text('id').primaryKey(),
  wallpaperId: text('wallpaper_id').notNull(),
  notification: jsonb('notification')
    .notNull()
    .$type<import('../catalog/index.js').AvailableNotification>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
