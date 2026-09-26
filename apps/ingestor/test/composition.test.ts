import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { WallpaperUploadedEventSchema } from '@wallpaperdb/events/schemas';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { connect, type NatsConnection } from 'nats';
import pg from 'pg';
import sharp from 'sharp';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Effect } from 'effect';
import { startIngestor } from '../src/server.js';
import { loadConfig, type Config } from '../src/config.js';

let database: StartedPostgreSqlContainer;
let storage: StartedTestContainer;
let broker: StartedNatsContainer;
let connection: NatsConnection;
let app: FastifyInstance;
let config: Config;
beforeAll(async () => {
  [database, storage, broker] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new GenericContainer('chrislusf/seaweedfs:4.47')
      .withEnvironment({ AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret' })
      .withCommand([
        'mini',
        '-dir=/data',
        '-ip=127.0.0.1',
        '-ip.bind=0.0.0.0',
        '-s3.port=9000',
        '-s3.autoCreateBucket=false',
        '-s3.port.iceberg=0',
        '-s3.port.lance=0',
        '-admin.ui=false',
        '-webdav=false',
        '-master.telemetry=false',
      ])
      .withExposedPorts(9000)
      .withWaitStrategy(
        Wait.forAll([
          Wait.forLogMessage('All enabled components are running and ready to use:'),
          Wait.forHttp('/healthz', 9000),
        ])
      )
      .start(),
    createNatsContainer(),
  ]);
  const databaseUrl = database.getConnectionUri().replace('localhost', '127.0.0.1');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
    });
  } finally {
    await pool.end();
  }
  const endpoint = `http://127.0.0.1:${storage.getMappedPort(9000)}`;
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
    forcePathStyle: true,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: 'wallpapers' }));
    await s3.send(new CreateBucketCommand({ Bucket: 'asset-references' }));
  } finally {
    s3.destroy();
  }
  connection = await connect({ servers: broker.getConnectionUrl() });
  await (await connection.jetstreamManager()).streams.add({
    name: 'WALLPAPER',
    subjects: ['wallpaper.uploaded'],
  });
  config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    S3_ENDPOINT: endpoint,
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    NATS_URL: broker.getConnectionUrl(),
    REDIS_ENABLED: 'false',
  });
  app = await createApp(config, { logger: false });
});
afterAll(async () => {
  await app?.close();
  await connection?.close();
  await Promise.all([database?.stop(), storage?.stop(), broker?.stop()]);
});
it('composes authenticated upload, durable asset publication, duplicate response, and health', async () => {
  const bytes = await sharp({
    create: { width: 1280, height: 720, channels: 3, background: '#245789' },
  })
    .png()
    .toBuffer();
  const payload = Buffer.concat([
    Buffer.from(
      '--file\r\nContent-Disposition: form-data; name="file"; filename="wallpaper.png"\r\nContent-Type: image/png\r\n\r\n'
    ),
    bytes,
    Buffer.from('\r\n--file--\r\n'),
  ]);
  const request = {
    method: 'POST' as const,
    url: '/upload',
    headers: {
      authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_composition' })).toString('base64')}`,
      'content-type': 'multipart/form-data; boundary=file',
    },
    payload,
  };
  const response = await app.inject(request);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ status: 'processing', width: 1280, height: 720 });
  const duplicate = await app.inject(request);
  expect(duplicate.json()).toMatchObject({ status: 'already_uploaded', id: response.json().id });
  const manager = await connection.jetstreamManager();
  const event = WallpaperUploadedEventSchema.parse(
    JSON.parse(
      new TextDecoder().decode((await manager.streams.getMessage('WALLPAPER', { seq: 1 })).data)
    )
  );
  expect(event.wallpaper).toMatchObject({
    id: response.json().id,
    userId: 'user_composition',
    mimeType: 'image/png',
  });
  expect((await app.inject('/health')).json().status).toBe('healthy');
  expect((await app.inject('/ready')).json().ready).toBe(true);
});
it('owns the listening lifetime and releases adapters when listener acquisition fails', async () => {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const port = Number(new URL(address).port);
  const failure = await Effect.runPromise(
    startIngestor({ ...config, port }).pipe(Effect.flip, Effect.scoped)
  );
  expect(failure).toMatchObject({ _tag: 'IngestorStartupError', stage: 'listener' });
  await Effect.runPromise(
    Effect.gen(function* () {
      const running = yield* startIngestor({ ...config, port: 0 });
      const response = yield* Effect.promise(() => fetch(`${running.address}/ready`));
      expect(response.status).toBe(200);
    }).pipe(Effect.scoped)
  );
});
