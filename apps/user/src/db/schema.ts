import type { ProfileCreatedEvent } from '@wallpaperdb/events';
import { sql } from 'drizzle-orm';
import {
  bigint,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const handleClaimKindEnum = pgEnum('handle_claim_kind', ['current', 'alias']);
export const profileEventTypeEnum = pgEnum('profile_event_type', ['profile.created']);
export const handleClaimGeneration = pgSequence('handle_claim_generation');

export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    biographyMarkdown: text('biography_markdown').notNull().default(''),
    pictureAssetId: text('picture_asset_id'),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('profiles_handle_unique').on(table.handle)]
);

export const handleClaims = pgTable('handle_claims', {
  handle: text('handle').primaryKey(),
  profileId: text('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  kind: handleClaimKindEnum('kind').notNull(),
  generation: bigint('generation', { mode: 'number' })
    .notNull()
    .default(sql`nextval('handle_claim_generation')`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const profileEvents = pgTable('profile_events', {
  id: text('id').primaryKey(),
  profileId: text('profile_id')
    .notNull()
    .references(() => profiles.id),
  type: profileEventTypeEnum('type').notNull(),
  profileVersion: bigint('profile_version', { mode: 'number' }).notNull(),
  event: jsonb('event').$type<ProfileCreatedEvent>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type HandleClaim = typeof handleClaims.$inferSelect;
export type ProfileEvent = typeof profileEvents.$inferSelect;
export type ProfileEventType = (typeof profileEventTypeEnum.enumValues)[number];
