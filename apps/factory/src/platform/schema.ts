import { sql } from 'drizzle-orm';
import {
  primaryKey,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
export const records = sqliteTable(
  'records',
  {
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.name] })]
);
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const planningAttempts = sqliteTable(
  'planning_attempts',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    startedAt: integer('started_at').notNull(),
    deadline: integer('deadline').notNull(),
    phase: text('phase', { enum: ['discovery', 'freshness', 'succeeded', 'failed'] }).notNull(),
    slot: integer('slot').notNull().default(1),
    finishedAt: integer('finished_at'),
    detail: text('detail'),
    result: text('result', { mode: 'json' }).$type<unknown>(),
  },
  (table) => [
    check('planning_attempt_slot', sql`${table.slot} = 1`),
    check(
      'planning_attempt_phase',
      sql`${table.phase} in ('discovery', 'freshness', 'succeeded', 'failed')`
    ),
    check('planning_attempt_revision', sql`${table.revision} >= 0`),
    uniqueIndex('one_active_planning_attempt')
      .on(table.slot)
      .where(sql`${table.phase} in ('discovery', 'freshness')`),
  ]
);
