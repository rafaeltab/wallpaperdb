import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
