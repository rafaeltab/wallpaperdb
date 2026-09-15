import type { ProfileCreatedEvent, ProfileUpdatedEvent } from '@wallpaperdb/events';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
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
  (table) => [index('outbox_events_unpublished_idx').on(table.publishedAt)]
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
