import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { ManagedRuntime } from 'effect';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, databaseLayer } from '../src/adapters/database/index.js';

describe('User database lifetime', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let observer: Pool;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    observer = new Pool({ connectionString: container.getConnectionUri() });
    await migrate(drizzle(observer), { migrationsFolder: './drizzle' });
  });
  afterAll(async () => {
    await observer?.end();
    await container?.stop();
  });
  it('cancels an active query and releases its connection before the next operation', async () => {
    const runtime = ManagedRuntime.make(databaseLayer({ databaseUrl: container.getConnectionUri() }));
    const database = await runtime.runPromise(Database);
    const controller = new AbortController();
    const pending = database.run((db) => db.execute(sql`select pg_sleep(60)`), controller.signal);
    const result = pending.then(() => 'completed', () => 'cancelled');
    try {
      await expect.poll(async () => {
        const result = await observer.query("select count(*)::int as count from pg_stat_activity where query='select pg_sleep(60)' and state='active'");
        return result.rows[0].count;
      }).toBe(1);
      controller.abort();
      expect(await result).toBe('cancelled');
      await expect.poll(async () => {
        const result = await observer.query("select count(*)::int as count from pg_stat_activity where query='select pg_sleep(60)' and state='active'");
        return result.rows[0].count;
      }).toBe(0);
      expect(await runtime.runPromise(Database.use((db) => db.check))).toBe(true);
    } finally {
      controller.abort();
      await result;
      await runtime.dispose();
    }
  });
});
