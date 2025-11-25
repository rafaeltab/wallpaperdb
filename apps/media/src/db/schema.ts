import { bigint, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
export const variants = pgTable('variants', {
  // Primary key - variant ID (e.g., var_01ABC...)
  id: text('id').primaryKey(),

  // Reference to parent wallpaper
  wallpaperId: text('wallpaper_id')
    .notNull()
    .references(() => wallpapers.id, { onDelete: 'cascade' }),

  // Storage information
  storageKey: text('storage_key').notNull(),

  // Variant dimensions
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Type exports for use in services
export type Wallpaper = typeof wallpapers.$inferSelect;
export type NewWallpaper = typeof wallpapers.$inferInsert;
export type Variant = typeof variants.$inferSelect;
export type NewVariant = typeof variants.$inferInsert;
