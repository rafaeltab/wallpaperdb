import type { ProfileCreatedEvent, ProfileUpdatedEvent } from '@wallpaperdb/events';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    handle: text('handle').notNull(),
    biographyMarkdown: text('biography_markdown').notNull().default(''),
    pictureAssetId: text('picture_asset_id'),
    version: integer('version').notNull().default(1),
    lastHandleChangedAt: timestamp('last_handle_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('profiles_handle_lower_idx').on(sql`lower(${table.handle})`)]
);

// Handles are shared claims so future aliases and profiles cannot overlap.
export const handleClaims = pgTable(
  'handle_claims',
  {
    handle: text('handle').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    kind: text('kind').notNull(),
    claimGeneration: bigserial('claim_generation', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('handle_claims_profile_id_idx').on(table.profileId),
    index('handle_claims_due_expiry_idx')
      .on(table.expiresAt, table.handle)
      .where(sql`${table.kind} = 'alias' and ${table.expiresAt} is not null`),
    uniqueIndex('handle_claims_handle_lower_idx').on(sql`lower(${table.handle})`),
  ]
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    subject: text('subject').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').$type<ProfileCreatedEvent | ProfileUpdatedEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_events_unpublished_idx').on(table.publishedAt),
    index('outbox_events_profile_history_idx').on(table.aggregateId, table.createdAt),
    index('outbox_events_profile_cleanup_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.publishedAt} is not null and ${table.subject} in ('profile.created', 'profile.updated')`),
  ]
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export const pictureAssetState = pgEnum('picture_asset_state', ['staged', 'active', 'retired']);
export const profilePictureAssets = pgTable(
  'profile_picture_assets',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    storageBucket: text('storage_bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').$type<'image/webp'>().notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    state: pictureAssetState('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [index('profile_picture_assets_cleanup_idx').on(table.expiresAt, table.id)]
);
export type ProfilePictureAsset = typeof profilePictureAssets.$inferSelect;
export type NewProfilePictureAsset = typeof profilePictureAssets.$inferInsert;

export const pictureImportStatus = pgEnum('picture_import_status', [
  'pending',
  'retrying',
  'complete',
]);
export const profilePictureImports = pgTable(
  'profile_picture_imports',
  {
    profileId: text('profile_id')
      .primaryKey()
      .references(() => profiles.id),
    sourceUrl: text('source_url'),
    status: pictureImportStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseToken: text('lease_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('profile_picture_imports_due_idx')
      .on(table.nextAttemptAt, table.profileId)
      .where(sql`${table.status} != 'complete'`),
  ]
);
export type ProfilePictureImport = typeof profilePictureImports.$inferSelect;
export type NewProfilePictureImport = typeof profilePictureImports.$inferInsert;

// A successfully uploaded Wallpaper is published. Ownership is immutable in the
// current event contract; no Profile FK because upload may precede lazy creation.
export const wallpaperOwnership = pgTable('wallpaper_ownership', {
  wallpaperId: text('wallpaper_id').primaryKey(),
  profileId: text('profile_id').notNull(),
});
export type WallpaperOwnership = typeof wallpaperOwnership.$inferSelect;
export type NewWallpaperOwnership = typeof wallpaperOwnership.$inferInsert;
