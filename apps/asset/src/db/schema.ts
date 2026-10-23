import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Wallpapers table - stores metadata from wallpaper.uploaded events
 * This is the asset service's own copy of wallpaper metadata
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
    .$type<import('../capabilities/catalog/index.js').AvailableNotification>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable target acceptance survives outbox acknowledgement and legacy row reconciliation. */
export const catalogTargets = pgTable('catalog_targets', {
  id: text('id').primaryKey(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assetConfiguration = pgTable(
  'asset_configuration',
  {
    id: integer('id').primaryKey(),
    revision: text('revision').notNull(),
  },
  (table) => [check('asset_configuration_singleton', sql`${table.id} = 1`)]
);

export const ownedAssets = pgTable(
  'owned_assets',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    assetType: text('asset_type').notNull(),
    ownerNamespace: text('owner_namespace').notNull(),
    ownerSubject: text('owner_subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('owned_assets_application_id', sql`${table.applicationId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check('owned_assets_type', sql`${table.assetType} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check('owned_assets_namespace', sql`octet_length(${table.ownerNamespace}) BETWEEN 1 AND 256`),
    check('owned_assets_subject', sql`octet_length(${table.ownerSubject}) BETWEEN 1 AND 256`),
  ]
);

export const assetCommands = pgTable(
  'asset_commands',
  {
    applicationId: text('application_id').notNull(),
    commandId: text('command_id').notNull(),
    canonical: text('canonical').notNull(),
    result: jsonb('result').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.applicationId, table.commandId] }),
    check('asset_commands_identity', sql`octet_length(${table.commandId}) BETWEEN 1 AND 128`),
  ]
);

export const assetResultOutbox = pgTable(
  'asset_result_outbox',
  {
    id: text('id').primaryKey(),
    context: jsonb('context')
      .notNull()
      .$type<import('../capabilities/lifecycle/index.js').CommandContext>(),
    applicationId: text('application_id').notNull(),
    commandId: text('command_id').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    result: jsonb('result').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseId: text('lease_id'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (table) => [
    index('asset_result_outbox_ready').on(table.status, table.availableAt),
    check(
      'asset_result_outbox_status',
      sql`${table.status} IN ('pending', 'publishing', 'published', 'quarantined')`
    ),
    check('asset_result_outbox_attempts', sql`${table.attempts} >= 0`),
  ]
);

/** One serialization boundary per owned Asset, independent of legacy catalogue rows. */
export const assetSourceState = pgTable('asset_source_state', {
  assetId: text('asset_id').primaryKey(),
  state: jsonb('state').notNull().$type<import('../capabilities/sources/index.js').SourceState>(),
});
/** Accepted identities can only be inserted. Conflicting replay never updates facts. */
export const immutableSources = pgTable(
  'immutable_sources',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    facts: jsonb('facts').notNull().$type<import('../capabilities/sources/index.js').SourceFacts>(),
    layout: text('layout').notNull(),
    evidenceExpiresAt: timestamp('evidence_expires_at', { withTimezone: true }),
  },
  (table) => [
    index('immutable_sources_retired_expiry')
      .on(table.evidenceExpiresAt)
      .where(sql`${table.evidenceExpiresAt} IS NOT NULL`),
    index('immutable_sources_asset').on(table.assetId),
    check('immutable_sources_layout', sql`${table.layout} = 'asset-layout-1'`),
  ]
);
export const sourceAcceptanceOutbox = pgTable('source_acceptance_outbox', {
  id: text('id').primaryKey(),
  confirmation: jsonb('confirmation')
    .notNull()
    .$type<import('../capabilities/sources/index.js').SourceConfirmation>(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  leaseId: text('lease_id'),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
});

/** Durable local responsibilities, not a public delivery event contract. The
 * compact terminal fence in owned_assets survives completion and byte expiry. */
export const assetDeletions = pgTable('asset_deletions', {
  assetId: text('asset_id').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull(),
  sourceSetRevision: text('source_set_revision').notNull(),
  deliveryRevision: text('delivery_revision').notNull(),
  evidenceExpiresAt: timestamp('evidence_expires_at', { withTimezone: true }).notNull(),
  capabilitiesPending: boolean('capabilities_pending').notNull().default(true),
  cleanupPending: boolean('cleanup_pending').notNull().default(true),
});

/** Exact identities remain as compact replay fences after their image facts are
 * purged. A null deadline is a current Source, never eligible for reclamation. */
export const sourceCleanup = pgTable(
  'source_cleanup',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    applicationId: text('application_id').notNull(),
    context: jsonb('context').$type<import('../capabilities/lifecycle/index.js').CommandContext>(),
    target: jsonb('target')
      .notNull()
      .$type<import('../capabilities/cleanup/index.js').CleanupTarget>(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseId: text('lease_id'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notificationId: text('notification_id').notNull().default(sql`gen_random_uuid()::text`),
  },
  (table) => [
    index('source_cleanup_ready').on(table.status, table.dueAt, table.availableAt),
    index('source_cleanup_asset').on(table.assetId),
    check(
      'source_cleanup_status',
      sql`${table.status} IN ('pending', 'reclaiming', 'completed', 'quarantined')`
    ),
    check('source_cleanup_attempts', sql`${table.attempts} >= 0`),
  ]
);

/** Finite, non-renewable read protection is independent of serving authority. */
export const sourceReads = pgTable(
  'source_reads',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    sourceId: text('source_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('source_reads_identity').on(table.assetId, table.sourceId, table.expiresAt),
    index('source_reads_expiry').on(table.expiresAt),
  ]
);
