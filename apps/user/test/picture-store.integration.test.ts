import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, Logger, ManagedRuntime } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { pictureStoreLayer } from '../src/adapters/pictures/index.js';
import { PictureStore, type StoredPicture } from '../src/pictures/index.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
describe('Picture persistence adapter', () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<PictureStore, unknown>;
  const now = new Date('2030-01-01T00:00:00Z');
  let asset: StoredPicture & { createdAt: Date } = {
    id: 'pic_candidate', profileId: 'owner', storageBucket: 'pictures', storageKey: 'owner/pic_candidate.webp',
    mimeType: 'image/webp', width: 2, height: 3, fileSizeBytes: 42, createdAt: now,
    expiresAt: new Date('2030-01-08T00:00:00Z'),
  };
  const run = <A>(operation: (store: PictureStore) => Effect.Effect<A, unknown>) => runtime.runPromise(Effect.flatMap(PictureStore, operation));
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    sql = postgres(container.getConnectionUri());
    for (const path of readdirSync(migrations).filter(path => path.endsWith('.sql')).sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    runtime = ManagedRuntime.make(pictureStoreLayer({ bucket: 'pictures' }).pipe(Layer.provide(databaseLayer({ databaseUrl: container.getConnectionUri() }))));
  });
  beforeEach(async () => {
    await sql`truncate profiles cascade`;
    await sql`insert into profiles (id, display_name, handle) values ('owner','Owner','owner')`;
  });
  afterAll(async () => { await runtime?.dispose(); await sql?.end(); await container?.stop(); });

  it('requires a finished PUT before a durable candidate becomes staged', async () => {
    asset = { ...await run(store => store.createCandidate(asset)), createdAt: now };
    expect(await run(store => store.available(asset.id))).toBe(false);
    expect(await run(store => store.beginUpload(asset.id, now))).toBe(true);
    expect(await run(store => store.finishUpload(asset.id, new Date(now.getTime() + 1000)))).toBe(true);
    expect(await sql`select state, upload_lease_until from profile_picture_assets`).toEqual([{ state: 'staged', upload_lease_until: null }]);
    expect(await run(store => store.finishUpload(asset.id, now))).toBe(false);
  });
  it('marks expired candidates deleting before storage work and never claims a live PUT', async () => {
    const current = new Date();
    asset = { ...await run(store => store.createCandidate({ ...asset, createdAt: current, expiresAt: new Date(current.getTime() + 1000) })), createdAt: current };
    expect(await run(store => store.beginUpload(asset.id, current))).toBe(true);
    const cutoff = new Date(current.getTime() + 2000);
    expect(await run(store => store.claimDeletion(asset.id, cutoff))).toBeNull();
    await run(store => store.finishUpload(asset.id, current));
    expect(await run(store => store.claimDeletion(asset.id, cutoff))).toMatchObject({ id: asset.id });
    expect(await sql`select state from profile_picture_assets`).toEqual([{ state: 'deleting' }]);
    expect(await run(store => store.finishUpload(asset.id, current))).toBe(false);
    expect(await run(store => store.claimDeletion(asset.id, cutoff))).toMatchObject({ id: asset.id });
    expect(await run(store => store.finishDeletion(asset.id))).toBe(true);
    expect(await run(store => store.finishDeletion(asset.id))).toBe(false);
  });

  it('preserves active references despite inconsistent asset state and stale sweeps', async () => {
    asset = { ...await run(store => store.createCandidate(asset)), createdAt: now };
    await sql`update profile_picture_assets set state = 'retired' where id = ${asset.id}`;
    await sql`update profiles set picture_asset_id = ${asset.id} where id = 'owner'`;
    expect(await run(store => store.claimDeletion(asset.id, new Date('2040-01-01')))).toBeNull();
    expect(await run(store => store.available(asset.id))).toBe(false);
    await sql`update profile_picture_assets set state = 'active' where id = ${asset.id}`;
    expect(await run(store => store.available(asset.id))).toBe(true);
  });

  it('fences retry writes after a later replica replaces the import lease', async () => {
    await sql`insert into profile_picture_imports(profile_id, source_url, next_attempt_at) values ('owner', 'https://img.clerk.com/private', ${now})`;
    const first = await run(store => store.claimImport('owner', now, 1000));
    expect(first).toMatchObject({ profileId: 'owner', attempts: 0 });
    expect(await run(store => store.claimImport('owner', now, 1000))).toBeNull();
    const second = await run(store => store.claimImport('owner', new Date(now.getTime() + 1000), 1000));
    expect(second).toMatchObject({ profileId: 'owner', attempts: 1 });
    if (!first || !second) throw new Error('Expected both lease generations');
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await run(store => store.settleImport(first, true, now));
    expect(await sql`select source_url, lease_token from profile_picture_imports`).toEqual([{ source_url: 'https://img.clerk.com/private', lease_token: second.leaseToken }]);
    await run(store => store.settleImport(second, true, now));
    expect(await sql`select source_url, status, lease_token, lease_until from profile_picture_imports`).toEqual([{ source_url: null, status: 'complete', lease_token: null, lease_until: null }]);
  });

  it('preserves diagnostic SQLSTATE without exposing captured source credentials in failures or logs', async () => {
    await sql`insert into profile_picture_imports(profile_id, source_url, next_attempt_at) values ('owner', 'https://img.clerk.com/private?token=private-credential', ${now})`;
    const job = await run(store => store.claimImport('owner', now, 1000));
    if (!job) throw new Error('Expected an import claim');
    await sql.unsafe(`create function reject_import_retry() returns trigger language plpgsql as $$ begin raise exception 'Rejected source %', NEW.source_url; end $$`);
    await sql.unsafe(`create trigger reject_import_retry before update on profile_picture_imports for each row execute function reject_import_retry()`);
    const logs: unknown[] = [];
    try {
      const failure = await runtime.runPromise(Effect.flatMap(PictureStore, store => store.settleImport(job, false, now)).pipe(
        Effect.provide(Logger.layer([Logger.make(({ message }) => { logs.push(message); })])),
      )).catch((failure: unknown) => failure);
      expect(failure).toMatchObject({ _tag: 'PictureUnavailable', cause: { sqlState: 'P0001' } });
      expect(inspect(failure, { depth: 10 })).not.toContain('private-credential');
      expect(inspect(logs, { depth: 10 })).not.toContain('private-credential');
      expect(inspect(logs, { depth: 10 })).toContain('P0001');
    } finally {
      await sql.unsafe('drop trigger reject_import_retry on profile_picture_imports');
      await sql.unsafe('drop function reject_import_retry()');
    }
  });

});
