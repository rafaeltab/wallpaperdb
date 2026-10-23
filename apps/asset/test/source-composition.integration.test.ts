import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { GenericContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { Pool } from 'pg';
import sharp from 'sharp';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { renderBrokerConfiguration, provisionAssetBroker } from '../src/adapters/commands/index.js';
import {
  sourcePostgresLayer,
  sourceStorageLayer,
  sourceConfirmationsLayer,
  SourceConfirmationHealth,
} from '../src/adapters/sources/index.js';
import { sourcesLayer } from '../src/capabilities/sources/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import { AuthorAuthentication } from '../src/adapters/authors/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { Availability } from '../src/capabilities/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
const authority = parseAuthority(authorityFixture());
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('composition-private');
let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let broker: Awaited<ReturnType<GenericContainer['start']>>;
let pool: Pool;
let application: NatsConnection;
let url: string;
beforeAll(async () => {
  await tester.setup();
  postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: postgres.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
  broker = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  url = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
  for (const app of Object.values(authority.applications)) {
    const operator = await connect({
      servers: url,
      user: app.operatorUser,
      pass: authority.broker.operator.password,
    });
    try {
      await provisionAssetBroker(operator, authority, app.id);
    } finally {
      await operator.close();
    }
  }
  application = await connect({
    servers: url,
    user: 'wallpaper-1',
    pass: 'wallpaper-secret',
    inboxPrefix: '_ASSET_INBOX.wallpaper',
  });
}, 60000);
afterAll(async () => {
  await application?.close();
  await pool?.end();
  await broker?.stop();
  await postgres?.stop();
  await tester.destroy();
});
it('accepts exact original bytes through HTTP and publishes sufficient committed logical confirmation over the protected application channel', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: postgres.getConnectionUri(),
      revision: authority.identity,
      ...authority.delivery,
      leaseMs: 1000,
    })
  );
  const persistence = sourcePostgresLayer({
    databaseUrl: postgres.getConnectionUri(),
    ...authority.delivery,
    leaseMs: 1000,
  });
  const s3 = tester.getS3();
  const bytes = sourceStorageLayer({
    endpoint: s3.endpoints.fromHost,
    region: 'us-east-1',
    accessKeyId: s3.options.accessKey,
    secretAccessKey: s3.options.secretKey,
    bucket: 'composition-private',
  });
  const sourceServices = sourcesLayer({
    revision: authority.identity,
    types: authority.assetTypes,
  }).pipe(Layer.provide(Layer.merge(persistence, bytes)));
  const publisher = ManagedRuntime.make(
    sourceConfirmationsLayer({
      url,
      credential: authority.broker.service,
      applications: authority.applications,
      ...authority.delivery,
    }).pipe(Layer.provide(persistence))
  );
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3003 },
    Layer.merge(
      Layer.succeed(Availability, {
        health: () => Effect.die('unused'),
        ready: () => Effect.die('unused'),
      }),
      Layer.succeed(AssetDelivery, {
        wallpaper: () => Effect.die('unused'),
        picture: () => Effect.die('unused'),
      })
    ),
    {
      sourceServices: Layer.merge(
        sourceServices,
        Layer.succeed(AuthorAuthentication, {
          verify: (token) =>
            Effect.succeed(
              token === 'Bearer owner' ? { namespace: 'clerk-test', subject: 'owner' } : null
            ),
        })
      ),
    }
  );
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: authority.identity,
          applicationId: 'wallpaper',
          canonical: 'http-one',
          correlation: { commandId: 'http-one', applicationReference: 'wallpaper-intent-one' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk-test', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'create-http-one' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    await publisher.runPromise(SourceConfirmationHealth);
    const headers = {
      authorization: 'Bearer owner',
      'idempotency-key': 'candidate-one',
      'x-correlation-id': 'wallpaper-intent-one',
    };
    const candidate = await app.inject({
      method: 'POST',
      url: `/assets/${created.assetId}/source-candidates`,
      headers,
      payload: { operation: 'add', expectedSourceSetRevision: '0' },
    });
    expect(candidate.statusCode).toBe(201);
    const id = candidate.json<{ candidateId: string }>().candidateId;
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/assets/${created.assetId}/source-candidates/${id}/bytes`,
          headers: { ...headers, 'content-type': 'application/octet-stream' },
          payload: png,
        })
      ).json()
    ).toMatchObject({ status: 'ready' });
    const accepted = await app.inject({
      method: 'POST',
      url: `/assets/${created.assetId}/source-candidates/${id}/accept`,
      headers,
      payload: { operation: 'add', expectedSourceSetRevision: '0' },
    });
    expect(accepted.statusCode).toBe(200);
    const sourceId = accepted.json<{ sourceId: string }>().sourceId;
    const original = await app.inject({
      url: `/assets/${created.assetId}/sources/${sourceId}/original`,
      headers,
    });
    expect(original.rawPayload).toEqual(png);
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/source_wrong/original`,
          headers,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (await app.inject(`/assets/${created.assetId}/sources/${sourceId}/original`)).statusCode
    ).toBe(401);
    const consumer = await application
      .jetstream()
      .consumers.get('ASSET_RESULTS', 'results_wallpaper');
    const message = await consumer.next({ expires: 5000 });
    expect(message).not.toBeNull();
    const event = message?.json<{
      id: string;
      type: string;
      data: unknown;
      correlationid: string;
    }>();
    expect(event).toMatchObject({
      type: 'asset.source.accepted',
      correlationid: 'wallpaper-intent-one',
      data: {
        assetId: created.assetId,
        sourceId,
        candidateId: id,
        sourceSetRevision: '1',
        deliveryRevision: '1',
        initialAnalysisSourceId: sourceId,
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/bucket|layout|storageKey|ownerSubject/);
    message?.ack();
    const replacementIntent = {
      operation: 'replace-one',
      expectedSourceSetRevision: '1',
      targetSourceId: sourceId,
    };
    const candidates: string[] = [];
    const replacementPng = await sharp({
      create: { width: 8, height: 6, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    for (const key of ['replacement-a', 'replacement-b']) {
      const proposed = await app.inject({
        method: 'POST',
        url: `/assets/${created.assetId}/source-candidates`,
        headers: { ...headers, 'idempotency-key': key },
        payload: replacementIntent,
      });
      expect(proposed.statusCode).toBe(201);
      const replacementId = proposed.json<{ candidateId: string }>().candidateId;
      candidates.push(replacementId);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/assets/${created.assetId}/source-candidates/${replacementId}/bytes`,
            headers: { ...headers, 'content-type': 'application/octet-stream' },
            payload: replacementPng,
          })
        ).json()
      ).toMatchObject({ status: 'ready' });
    }
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/${sourceId}/original`,
          headers,
        })
      ).rawPayload
    ).toEqual(png);
    const race = await Promise.all(
      candidates.map((replacementId) =>
        app.inject({
          method: 'POST',
          url: `/assets/${created.assetId}/source-candidates/${replacementId}/accept`,
          headers,
          payload: replacementIntent,
        })
      )
    );
    expect(race.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = race
      .find((response) => response.statusCode === 200)
      ?.json<{ candidateId: string; sourceId: string }>();
    if (!winner) throw new Error('Expected replacement winner');
    expect(winner.sourceId).not.toBe(sourceId);
    expect(
      (await app.inject({ url: `/assets/${created.assetId}/sources`, headers })).json()
    ).toMatchObject({
      assetId: created.assetId,
      sourceSetRevision: '2',
      deliveryRevision: '2',
      defaultSourceId: winner.sourceId,
      sources: [{ sourceId: winner.sourceId }],
    });
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/${sourceId}/original`,
          headers,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/${winner.sourceId}/original`,
          headers,
        })
      ).rawPayload
    ).toEqual(replacementPng);
    const retirement = await pool.query<{ evidence_expires_at: Date }>(
      'SELECT evidence_expires_at FROM immutable_sources WHERE id = $1',
      [sourceId]
    );
    const deadline = retirement.rows[0]?.evidence_expires_at;
    expect(deadline).toBeInstanceOf(Date);
    expect((deadline?.getTime() ?? 0) - Date.now()).toBeGreaterThan(604790000);
    // An old callback is fenced; a winner replay cannot reset retirement or create a third membership revision.
    const replay = await Promise.all(
      candidates.map((replacementId) =>
        app.inject({
          method: 'POST',
          url: `/assets/${created.assetId}/source-candidates/${replacementId}/accept`,
          headers,
          payload: replacementIntent,
        })
      )
    );
    expect(replay.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
          sourceId,
        ])
      ).rows
    ).toEqual(retirement.rows);
    const replacementMessage = await consumer.next({ expires: 5000 });
    expect(replacementMessage?.json()).toMatchObject({
      type: 'asset.source.accepted',
      data: {
        assetId: created.assetId,
        sourceId: winner.sourceId,
        initialAnalysisSourceId: sourceId,
        defaultSourceId: winner.sourceId,
        sourceSetRevision: '2',
        deliveryRevision: '2',
      },
    });
    replacementMessage?.ack();
    expect(await publisher.runPromise(SourceConfirmationHealth.use((s) => s.check()))).toBe(true);
  } finally {
    await app.close();
    await publisher.dispose();
    await lifecycle.dispose();
  }
});
