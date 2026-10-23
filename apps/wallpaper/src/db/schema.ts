import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Wallpaper } from '../capabilities/creation/index.js';
export const wallpaperIntents = pgTable(
  'wallpaper_intents',
  {
    id: text('id').primaryKey(),
    ownerNamespace: text('owner_namespace').notNull(),
    contributorId: text('contributor_id').notNull(),
    key: text('request_key').notNull(),
    assetId: text('asset_id'),
    state: jsonb('state').$type<Wallpaper>().notNull(),
  },
  (t) => [
    uniqueIndex('wallpaper_request_identity').on(t.ownerNamespace, t.contributorId, t.key),
    uniqueIndex('wallpaper_asset_identity').on(t.assetId),
  ]
);
export const workflowOutbox = pgTable(
  'wallpaper_workflow_outbox',
  {
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    id: text('id').primaryKey(),
    wallpaperId: text('wallpaper_id')
      .notNull()
      .references(() => wallpaperIntents.id),
    destination: text('destination').notNull(),
    event: jsonb('event').$type<Readonly<Record<string, unknown>>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseId: text('lease_id'),
  },
  (t) => [
    index('wallpaper_outbox_due').on(t.status, t.availableAt),
    check(
      'wallpaper_outbox_status',
      sql`${t.status} IN ('pending','leased','published','quarantined')`
    ),
  ]
);
export const workflowQuarantine = pgTable('wallpaper_workflow_quarantine', {
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  recoveredAt: timestamp('recovered_at', { withTimezone: true }),
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
