import { once } from 'node:events';
import { createServer } from 'node:http';
import { runAttachmentOperator } from '../scripts/attachment-operator.js';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { GenericContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { Pool } from 'pg';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assetFixture } from './helpers/asset-fixture.js';
import { z } from 'zod';
import { createApp as createUserApp } from '../src/app.js';
import type { Config } from '../src/config.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const notices: unknown[] = [];
const inbox = createServer(async (request, response) => {
  if (request.headers.authorization !== 'Bearer inbox-secret') {
    response.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  notices.push(JSON.parse(Buffer.concat(chunks).toString()));
  response.writeHead(200).end();
});
const tester = new Tester().withS3().withS3Bucket('picture-attachment-roundtrip');
let assetDatabase: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let userDatabase: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let broker: Awaited<ReturnType<GenericContainer['start']>>;
let userPool: Pool;
let nats: NatsConnection;
let operator: NatsConnection;
let application: NatsConnection;
let natsUrl: string;
let user: FastifyInstance;
let config: Config;
const descriptorSchema = z.object({
  brokerConfiguration: z.string(),
  delivery: z.object({
    maxAttempts: z.number(),
    retryDelayMs: z.number(),
    pollMs: z.number(),
    shutdownTimeoutMs: z.number(),
  }),
  application: z.object({ user: z.string(), password: z.string() }),
  operator: z.object({ user: z.string(), password: z.string() }),
});
let descriptor: z.infer<typeof descriptorSchema>;
let fixture: ReturnType<typeof assetFixture> | undefined;
let assetUrl: string;
const control = (operation: string, options?: unknown) => {
  if (!fixture) throw new Error('Missing owned Asset fixture');
  return fixture.call(operation, options);
};
const asset = {
  inject: async (input: {
    method?: string;
    url: string;
    headers: Record<string, string>;
    payload?: unknown;
  }) => {
    const headers = { ...input.headers };
    const payload = input.payload;
    const body = Buffer.isBuffer(payload)
      ? new Uint8Array(payload)
      : payload === undefined
        ? undefined
        : JSON.stringify(payload);
    if (body !== undefined && !Buffer.isBuffer(payload))
      headers['content-type'] = 'application/json';
    const response = await fetch(new URL(input.url, assetUrl), {
      method: input.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    const rawPayload = Buffer.from(await response.arrayBuffer());
    return {
      statusCode: response.status,
      rawPayload,
      json: <A = unknown>(): A => JSON.parse(rawPayload.toString()),
    };
  },
};
const headers = (id = 'owner') => ({
  authorization: `Bearer ${Buffer.from(JSON.stringify({ id })).toString('base64')}`,
});
const startUser = () =>
  createUserApp(config, {
    workers: false,
    identities: {
      getIdentity: () =>
        Effect.succeed({ displayName: 'Picture Owner', firstName: null, lastName: null }),
    },
  });
async function poll<A>(get: () => Promise<A>, ready: (a: A) => boolean) {
  const until = Date.now() + 10000;
  let value = await get();
  while (!ready(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 20));
    value = await get();
  }
  expect(ready(value)).toBe(true);
  return value;
}
beforeAll(async () => {
  inbox.listen(0, '127.0.0.1');
  await once(inbox, 'listening');
  const address = inbox.address();
  if (!address || typeof address === 'string') throw new Error('Missing operator address');
  await tester.setup();
  assetDatabase = await new PostgreSqlContainer('postgres:16-alpine').start();
  userDatabase = await new PostgreSqlContainer('postgres:16-alpine').start();
  userPool = new Pool({ connectionString: userDatabase.getConnectionUri() });
  await migrate(drizzle(userPool), {
    migrationsFolder: new URL('../drizzle/', import.meta.url).pathname,
  });
  fixture = assetFixture();
  descriptor = descriptorSchema.parse(await control('describe'));
  broker = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: descriptor.brokerConfiguration, target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  natsUrl = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
  nats = await connect({ servers: natsUrl });
  const manager = await nats.jetstreamManager();
  await manager.streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] });
  await manager.streams.add({ name: 'PROFILE', subjects: ['profile.>'] });
  const s3 = tester.getS3();
  assetUrl = z.object({ url: z.string().url() }).parse(
    await control('configure', {
      databaseUrl: assetDatabase.getConnectionUri(),
      natsUrl,
      storage: {
        endpoint: s3.endpoints.fromHost,
        accessKeyId: s3.options.accessKey,
        secretAccessKey: s3.options.secretKey,
        bucket: 'picture-attachment-roundtrip',
      },
    })
  ).url;
  operator = await connect({
    servers: natsUrl,
    user: descriptor.operator.user,
    pass: descriptor.operator.password,
  });
  application = await connect({
    servers: natsUrl,
    user: descriptor.application.user,
    pass: descriptor.application.password,
    inboxPrefix: '_ASSET_INBOX.user',
  });
  config = {
    port: 3009,
    nodeEnv: 'test',
    databaseUrl: userDatabase.getConnectionUri(),
    natsUrl,
    natsStream: 'WALLPAPER',
    otelServiceName: 'user-test',
    profileHandleMinLength: 1,
    profileHandleMaxLength: 20,
    profileDisplayNameMaxLength: 80,
    profileBiographyMaxLength: 5000,
    profileRetainedAliasLimit: 3,
    profileEvidenceRetentionDays: 30,
    s3Region: 'us-east-1',
    s3Endpoint: s3.endpoints.fromHost,
    s3AccessKeyId: s3.options.accessKey,
    s3SecretAccessKey: s3.options.secretKey,
    profilePictureBucket: 'picture-attachment-roundtrip',
    profilePictureMaxBytes: 5242880,
    profilePictureMaxPixels: 16000000,
    profilePictureMaxDecodedBytes: 67108864,
    profilePictureImportTimeoutMs: 10000,
    profilePictureImportHosts: ['img.clerk.com'],
    attachmentWorkflow: {
      credential: descriptor.application,
      operatorNotification: {
        url: `http://127.0.0.1:${address.port}/events`,
        token: 'inbox-secret',
      },
      ...descriptor.delivery,
    },
  };
  await control('start-commands');
  user = await startUser();
}, 60000);
afterAll(async () => {
  const errors: unknown[] = [];
  const cleanup = async (operation: () => Promise<unknown> | undefined) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await cleanup(() => user?.close());
  await cleanup(() => fixture?.close());
  await cleanup(() => application?.close());
  await cleanup(() => operator?.close());
  await cleanup(() => nats?.close());
  await cleanup(() => userPool?.end());
  await cleanup(() => broker?.stop());
  await cleanup(() => userDatabase?.stop());
  await cleanup(() => assetDatabase?.stop());
  await cleanup(() => tester.destroy());
  inbox.closeAllConnections();
  await cleanup(() => new Promise<void>((resolve) => inbox.close(() => resolve())));
  if (errors.length) throw new AggregateError(errors, 'Owned roundtrip cleanup failed');
});
it('attaches a canonical SDR Source only after durable User confirmation, and preserves intent and Profile through restart/replay', async () => {
  const profile = await user.inject({
    method: 'POST',
    url: '/profile/me/ensure',
    headers: headers(),
  });
  expect(profile.statusCode).toBe(200);
  const version = profile.json<{ version: number }>().version;
  const started = await user.inject({
    method: 'POST',
    url: '/profile/me/picture-attachments',
    headers: { ...headers(), 'idempotency-key': 'picture-A' },
    payload: { expectedVersion: version },
  });
  expect(started.statusCode).toBe(202);
  const attachmentId = started.json<{ attachmentId: string }>().attachmentId;
  const status = async () =>
    (
      await user.inject({
        url: `/profile/me/picture-attachments/${attachmentId}`,
        headers: headers(),
      })
    ).json<{ state: string; assetId: string; sourceId: string | null }>();
  const created = await poll(status, (s) => s.state === 'awaiting-source');
  expect(created.assetId).toMatch(/^asset_/);
  const image = await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#33669988' },
  })
    .webp()
    .toBuffer();
  const author = { authorization: 'Bearer owner' };
  const input = { operation: 'add', expectedSourceSetRevision: '0' };
  const candidate = await asset.inject({
    method: 'POST',
    url: `/assets/${created.assetId}/source-candidates`,
    headers: { ...author, 'idempotency-key': 'candidate-A' },
    payload: input,
  });
  expect(candidate.statusCode).toBe(201);
  const candidateId = candidate.json<{ candidateId: string }>().candidateId;
  expect(
    (
      await asset.inject({
        method: 'PUT',
        url: `/assets/${created.assetId}/source-candidates/${candidateId}/bytes`,
        headers: { ...author, 'content-type': 'application/octet-stream' },
        payload: image,
      })
    ).json()
  ).toMatchObject({ status: 'ready' });
  expect(
    (
      await user.inject({
        method: 'PUT',
        url: `/profile/me/picture-attachments/${attachmentId}/first-source`,
        headers: headers(),
        payload: { candidateId, intentId: 'edit-A' },
      })
    ).statusCode
  ).toBe(202);
  const accepted = await asset.inject({
    method: 'POST',
    url: `/assets/${created.assetId}/source-candidates/${candidateId}/accept`,
    headers: { ...author, 'x-correlation-id': 'edit-A' },
    payload: input,
  });
  expect(accepted.statusCode).toBe(200);
  const sourceId = accepted.json<{ sourceId: string }>().sourceId;
  expect((await status()).state).toBe('accepting-source');
  expect(
    (await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers() })).json()
  ).toMatchObject({ version, pictureAssetId: null });
  await user.close();
  user = await startUser();
  await control('start-confirmations');
  expect(await poll(status, (s) => s.state === 'attached')).toMatchObject({
    assetId: created.assetId,
    sourceId,
  });
  expect(
    (await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers() })).json()
  ).toMatchObject({ version: version + 1, pictureAssetId: created.assetId });
  expect(
    (
      await asset.inject({
        url: `/assets/${created.assetId}/sources/${sourceId}/original`,
        headers: author,
      })
    ).rawPayload
  ).toEqual(image);
  const command = (
    await userPool.query<{ event: Record<string, unknown> }>(
      'select event from picture_attachment_outbox where attachment_id=$1 and destination=$2',
      [attachmentId, 'asset-create']
    )
  ).rows[0]?.event;
  if (!command) throw new Error('Missing durable creation command');
  const manager = await operator.jetstreamManager();
  const resultsBeforeReplay = (await manager.streams.info('ASSET_RESULTS')).state.last_seq;
  await poll(
    () => manager.consumers.info('ASSET_RESULTS', 'results_user'),
    (state) => state.ack_floor.stream_seq >= resultsBeforeReplay
  );
  const quarantineBeforeReplay = (await manager.streams.info('ASSET_QUARANTINE')).state.last_seq;
  const profileEvents = () =>
    userPool.query('select id,payload from outbox_events where aggregate_id=$1 order by id', [
      'owner',
    ]);
  const eventsBeforeReplay = (await profileEvents()).rows;
  const replay = await application
    .jetstream()
    .publish('asset.commands.user.create', JSON.stringify(command));
  expect(replay.duplicate).toBe(false);
  await poll(
    () => manager.consumers.info('ASSET_COMMANDS', 'commands_user'),
    (state) => state.ack_floor.stream_seq >= replay.seq
  );
  // The identical command occurrence retains its already published result identity.
  expect((await manager.streams.info('ASSET_RESULTS')).state.last_seq).toBe(resultsBeforeReplay);
  expect((await manager.streams.info('ASSET_QUARANTINE')).state.last_seq).toBe(
    quarantineBeforeReplay
  );
  expect(await status()).toMatchObject({ state: 'attached', assetId: created.assetId, sourceId });
  expect(
    (await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers() })).json()
  ).toMatchObject({ version: version + 1, pictureAssetId: created.assetId });
  expect((await profileEvents()).rows).toEqual(eventsBeforeReplay);
  expect(
    (
      await user.inject({
        method: 'DELETE',
        url: `/profile/me/picture-attachments/${attachmentId}`,
        headers: headers(),
      })
    ).statusCode
  ).toBe(409);
}, 30000);
it('durably accepts and cancels while Asset is unavailable, then deletes a late-created orphan through User authority', async () => {
  await control('stop-commands');
  const owner = 'cancelled-owner';
  expect(
    (await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers(owner) }))
      .statusCode
  ).toBe(200);
  const begin = await user.inject({
    method: 'POST',
    url: '/profile/me/picture-attachments',
    headers: { ...headers(owner), 'idempotency-key': 'cancelled-picture' },
    payload: { expectedVersion: 1 },
  });
  expect(begin.statusCode).toBe(202);
  const id = begin.json<{ attachmentId: string }>().attachmentId;
  const status = async () =>
    (
      await user.inject({ url: `/profile/me/picture-attachments/${id}`, headers: headers(owner) })
    ).json<{ state: string; assetId: string | null; deletion: string }>();
  expect((await status()).state).toBe('creating-asset');
  expect(
    (
      await user.inject({
        method: 'DELETE',
        url: `/profile/me/picture-attachments/${id}`,
        headers: headers(owner),
      })
    ).statusCode
  ).toBe(200);
  await user.close();
  user = await startUser();
  await control('start-commands');
  const cancelled = await poll(status, (s) => s.deletion === 'complete');
  expect(cancelled.state).toBe('cancelled');
  expect(cancelled.assetId).toMatch(/^asset_/);
  expect(
    (
      await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers(owner) })
    ).json()
  ).toMatchObject({ version: 1, pictureAssetId: null });
  expect(
    (
      await asset.inject({
        url: `/assets/${cancelled.assetId}/sources`,
        headers: { authorization: `Bearer ${owner}` },
      })
    ).statusCode
  ).toBe(404);
  const deletion = (
    await userPool.query<{ event: { data: { assetId: string }; id: string } }>(
      'select event from picture_attachment_outbox where attachment_id=$1 and destination=$2',
      [id, 'asset-delete']
    )
  ).rows;
  expect(deletion).toHaveLength(1);
  expect(deletion[0]?.event.data.assetId).toBe(cancelled.assetId);
}, 30000);

it('quarantines exhausted User confirmation effects, routes an operator notice and deliberately recovers the retained identity after restart', async () => {
  await control('stop-commands');
  const owner = 'recovery-owner';
  await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers(owner) });
  const begin = await user.inject({
    method: 'POST',
    url: '/profile/me/picture-attachments',
    headers: { ...headers(owner), 'idempotency-key': 'recovery-picture' },
    payload: { expectedVersion: 1 },
  });
  expect(begin.statusCode).toBe(202);
  const id = begin.json<{ attachmentId: string }>().attachmentId;
  await userPool.query(
    `create function reject_attachment_confirmation() returns trigger language plpgsql as $$ begin if NEW.profile_id='recovery-owner' and NEW.asset_id is not null and OLD.asset_id is null then raise exception 'controlled confirmation outage'; end if;return NEW;end $$`
  );
  await userPool.query(
    'create trigger reject_attachment_confirmation before update on picture_attachment_intents for each row execute function reject_attachment_confirmation()'
  );
  await control('start-commands');
  const retained = await poll(
    async () =>
      (
        await userPool.query<{ id: string }>(
          'select id from picture_attachment_quarantine where recovered_at is null'
        )
      ).rows,
    (rows) => rows.length === 1
  );
  await poll(
    async () => notices,
    (values) => values.length > 0
  );
  expect(notices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        applicationId: 'user',
        kind: 'user-workflow-quarantine',
        reason: 'exhausted',
        recoveryScope: 'confirmation',
      }),
    ])
  );
  await userPool.query(
    'drop trigger reject_attachment_confirmation on picture_attachment_intents;drop function reject_attachment_confirmation()'
  );
  await user.close();
  user = await startUser();
  const recovery = retained[0];
  if (!recovery) throw new Error('Missing retained confirmation');
  expect(
    await runAttachmentOperator(['recover-confirmation', recovery.id], {
      databaseUrl: config.databaseUrl,
      ...descriptor.delivery,
    })
  ).toEqual({ recovered: true });
  expect(
    await runAttachmentOperator(['recover-confirmation', recovery.id], {
      databaseUrl: config.databaseUrl,
      ...descriptor.delivery,
    })
  ).toEqual({ recovered: false });
  const status = async () =>
    (
      await user.inject({ url: `/profile/me/picture-attachments/${id}`, headers: headers(owner) })
    ).json<{ state: string; assetId: string | null; deletion: string }>();
  expect((await status()).state).toBe('awaiting-source');
  expect(
    (
      await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers(owner) })
    ).json()
  ).toMatchObject({ version: 1, pictureAssetId: null });
  expect(
    (
      await user.inject({
        method: 'DELETE',
        url: `/profile/me/picture-attachments/${id}`,
        headers: headers(owner),
      })
    ).statusCode
  ).toBe(200);
  expect((await poll(status, (s) => s.deletion === 'complete')).state).toBe('cancelled');
}, 30000);

it('quarantines a broker-delivered permanent rejection fixture without falsely completing orphan deletion', async () => {
  const owner = 'rejected-delete-owner';
  await user.inject({ method: 'POST', url: '/profile/me/ensure', headers: headers(owner) });
  const begin = await user.inject({
    method: 'POST',
    url: '/profile/me/picture-attachments',
    headers: { ...headers(owner), 'idempotency-key': 'rejected-delete' },
    payload: { expectedVersion: 1 },
  });
  expect(begin.statusCode).toBe(202);
  const id = begin.json<{ attachmentId: string }>().attachmentId;
  const status = async () =>
    (
      await user.inject({ url: `/profile/me/picture-attachments/${id}`, headers: headers(owner) })
    ).json<{ state: string; assetId: string; deletion: string; attentionRequired?: boolean }>();
  await poll(status, (s) => s.state === 'awaiting-source');
  await control('stop-commands');
  await user.inject({
    method: 'DELETE',
    url: `/profile/me/picture-attachments/${id}`,
    headers: headers(owner),
  });
  const row = (
    await userPool.query<{
      event: {
        id: string;
        data: { commandId: string; applicationReference: string; assetId: string };
      };
    }>('select event from picture_attachment_outbox where attachment_id=$1 and destination=$2', [
      id,
      'asset-delete',
    ])
  ).rows[0];
  if (!row) throw new Error('Missing deletion command');
  // Controlled external result fixture for the driving adapter. Asset's real
  // deletion command service is stopped; this does not claim an Asset rejection.
  await operator.jetstream().publish(
    'asset.results.user',
    JSON.stringify({
      specversion: '1.0',
      id: 'controlled-rejected-delete',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      causationsource: 'https://wallpaperdb/user',
      causationid: row.event.id,
      correlationid: id,
      data: { ...row.event.data, outcome: 'rejected', reason: 'forbidden-operation' },
    })
  );
  const retained = await poll(
    async () =>
      (
        await userPool.query<{ id: string }>(
          "select id from picture_attachment_quarantine where reason='rejected-confirmation' and recovered_at is null"
        )
      ).rows,
    (rows) => rows.length === 1
  );
  const recovery = retained[0];
  if (!recovery) throw new Error('Missing rejected confirmation');
  expect(await status()).toMatchObject({
    state: 'cancelled',
    deletion: 'pending',
    attentionRequired: true,
  });
  expect(
    await runAttachmentOperator(['recover-confirmation', recovery.id], {
      databaseUrl: config.databaseUrl,
      ...descriptor.delivery,
    })
  ).toEqual({ recovered: false });
  await control('start-commands');
  await poll(status, (s) => s.deletion === 'complete');
  expect(
    await runAttachmentOperator(['recover-confirmation', recovery.id], {
      databaseUrl: config.databaseUrl,
      ...descriptor.delivery,
    })
  ).toEqual({ recovered: true });
}, 30000);
