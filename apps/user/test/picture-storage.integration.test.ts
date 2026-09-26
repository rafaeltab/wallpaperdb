import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { pictureStorageLayer, pictureStoreLayer } from '../src/adapters/pictures/index.js';
import { PictureObjects, PictureStore } from '../src/pictures/index.js';

describe('Private immutable picture storage', () => {
  const Tester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const tester = new Tester().withS3().withS3Bucket('picture-adapter');
  let runtime: ManagedRuntime.ManagedRuntime<PictureObjects | PictureStore, unknown>;
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let client: S3Client;
  const address = { Bucket: 'picture-adapter', Key: 'legacy/original.webp' };
  beforeAll(async () => {
    await tester.setup();
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    sql = postgres(container.getConnectionUri());
    const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
    for (const path of readdirSync(migrations)
      .filter((path) => path.endsWith('.sql'))
      .sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    await sql`insert into profiles (id, display_name, handle) values ('owner', 'Owner', 'owner')`;
    const config = tester.s3.config;
    client = tester.s3.getS3Client();
    runtime = ManagedRuntime.make(
      Layer.mergeAll(
        pictureStoreLayer({ bucket: 'new-picture-bucket' }),
        pictureStorageLayer({
          endpoint: config.endpoints.fromHost,
          region: 'us-east-1',
          accessKeyId: config.options.accessKey,
          secretAccessKey: config.options.secretKey,
        })
      ).pipe(Layer.provide(databaseLayer({ databaseUrl: container.getConnectionUri() })))
    );
  });
  afterAll(async () => {
    await runtime?.dispose();
    client?.destroy();
    await sql?.end();
    await container?.stop();
    await tester.destroy();
  });
  it('preserves first stored bytes, keeps objects private, and retries deletion safely', async () => {
    const asset = await runtime.runPromise(
      Effect.flatMap(PictureStore, (store) =>
        store.createCandidate({
          profileId: 'owner',
          mimeType: 'image/webp',
          width: 2,
          height: 3,
          fileSizeBytes: 5,
          createdAt: new Date(),
          expiresAt: null,
        })
      )
    );
    // Old rows retain their original address even after the configured bucket or key layout changes.
    await sql`update profile_picture_assets set storage_bucket = ${address.Bucket}, storage_key = ${address.Key} where id = ${asset.id}`;
    await runtime.runPromise(
      Effect.flatMap(PictureObjects, (objects) => objects.put(asset.id, Buffer.from('first')))
    );
    await expect(
      runtime.runPromise(
        Effect.flatMap(PictureObjects, (objects) => objects.put(asset.id, Buffer.from('other')))
      )
    ).rejects.toMatchObject({ _tag: 'PictureUnavailable' });
    const object = await client.send(new GetObjectCommand(address));
    expect(await object.Body?.transformToString()).toBe('first');
    expect(object.ContentType).toBe('image/webp');
    expect(
      (await fetch(`${tester.s3.config.endpoints.fromHost}/${address.Bucket}/${address.Key}`))
        .status
    ).toBe(403);
    for (let attempt = 0; attempt < 2; attempt++) {
      await runtime.runPromise(
        Effect.flatMap(PictureObjects, (objects) => objects.delete(asset.id))
      );
    }
    await expect(client.send(new GetObjectCommand(address))).rejects.toMatchObject({
      name: 'NoSuchKey',
    });
  });
});
