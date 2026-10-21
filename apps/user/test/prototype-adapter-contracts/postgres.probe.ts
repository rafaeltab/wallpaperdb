import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, ManagedRuntime } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseLayer } from '../../src/adapters/database/index.js';
import { profileStoreLayer } from '../../src/adapters/profiles/index.js';
import { eventStoreLayer } from '../../src/adapters/events/index.js';
import { MaintenanceStore } from '../../src/capabilities/maintenance/index.js';
import { ProfileStore } from '../../src/capabilities/profile/index.js';
import { profilePolicy } from '../helpers/profiles.js';
import { cases, seed, type Fixture } from './contract.js';

describe('production PostgreSQL adapter, real isolated databases', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let admin: ReturnType<typeof postgres> | undefined;
  const ownedDatabases = new Set<string>();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withLabels({ 'wallpaperdb.prototype': 'issue-419' })
      .withStartupTimeout(45000)
      .start();
    admin = postgres(container.getConnectionUri(), { onnotice: () => {} });
  });
  afterAll(async () => {
    try {
      if (admin) {
        for (const name of ownedDatabases) {
          await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
        }
      }
    } finally {
      try {
        await admin?.end({ timeout: 5 });
      } finally {
        await container?.stop({ timeout: 10000 });
      }
    }
  });

  async function fixture(failAfterSetup = false): Promise<Fixture> {
    if (!admin || !container) throw new Error('PostgreSQL fixture not started');
    const control = admin;
    const name = `prototype_419_${randomUUID().replaceAll('-', '')}`;
    await control.unsafe(`CREATE DATABASE "${name}"`);
    ownedDatabases.add(name);
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const sql = postgres(url.toString(), { onnotice: () => {} });
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(profileStoreLayer(profilePolicy), eventStoreLayer()).pipe(
        Layer.provide(databaseLayer({ databaseUrl: url.toString() }))
      )
    );
    const dispose = async () => {
      try {
        await runtime.dispose();
      } finally {
        try {
          await sql.end({ timeout: 5 });
        } finally {
          try {
            await expect
              .poll(
                async () => {
                  const [row] =
                    await control`select count(*) from pg_stat_activity where datname = ${name}`;
                  return Number(row.count);
                },
                { timeout: 2000 }
              )
              .toBe(0);
          } finally {
            await control.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
            ownedDatabases.delete(name);
            expect(
              await control`select datname from pg_database where datname = ${name}`,
              'owned database was removed'
            ).toHaveLength(0);
          }
        }
      }
    };
    try {
      const migrations = new URL('../../drizzle/', import.meta.url);
      for (const file of readdirSync(migrations)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        await sql.unsafe(readFileSync(new URL(file, migrations), 'utf8'));
      }
      // The same fixed IDs are reused by every case. Empty storage before each
      // case and verified database removal afterward detect fixture leakage.
      expect(await sql`select id from profiles`, 'fresh profile state').toHaveLength(0);
      const store = await runtime.runPromise(ProfileStore);
      const occurrences = () =>
        runtime.runPromise(
          MaintenanceStore.use((s) => s.pendingEvents().pipe(Effect.map((events) => events.length)))
        );
      expect(await occurrences(), 'fresh occurrence state').toBe(0);
      if (failAfterSetup) {
        await seed(store);
        throw new Error('deliberate partial setup failure');
      }
      return { store, occurrences, dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  it('cleans a seeded database when setup fails before handing it to a case', async () => {
    await expect(fixture(true)).rejects.toThrow('deliberate partial setup failure');
    expect(ownedDatabases.size, 'failed setup released its owned database').toBe(0);
  });

  for (const test of cases)
    it(test.id, async () => {
      const f = await fixture();
      try {
        await test.check(f);
      } finally {
        await f.dispose();
      }
    });
});
