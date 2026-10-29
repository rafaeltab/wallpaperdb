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
import { SourceBytes, Sources, sourcesLayer } from '../src/capabilities/sources/index.js';
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
    const acceptanceStartedAt = Date.now();
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
    const acceptanceFinishedAt = Date.now();
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
    const retiredAt = (deadline?.getTime() ?? 0) - 7 * 24 * 60 * 60 * 1000;
    expect(retiredAt).toBeGreaterThanOrEqual(acceptanceStartedAt);
    expect(retiredAt).toBeLessThanOrEqual(acceptanceFinishedAt);
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
    const addition = { operation: 'add', expectedSourceSetRevision: '2' };
    const proposed = await app.inject({
      method: 'POST',
      url: `/assets/${created.assetId}/source-candidates`,
      headers: { ...headers, 'idempotency-key': 'default-next' },
      payload: addition,
    });
    expect(proposed.statusCode).toBe(201);
    const nextCandidate = proposed.json<{ candidateId: string }>().candidateId;
    await app.inject({
      method: 'PUT',
      url: `/assets/${created.assetId}/source-candidates/${nextCandidate}/bytes`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: png,
    });
    const added = await app.inject({
      method: 'POST',
      url: `/assets/${created.assetId}/source-candidates/${nextCandidate}/accept`,
      headers,
      payload: addition,
    });
    expect(added.statusCode).toBe(200);
    const nextSource = added.json<{ sourceId: string }>().sourceId;
    const selected = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.inject({
          method: 'PUT',
          url: `/assets/${created.assetId}/default-source`,
          headers,
          payload: { sourceId: nextSource, expectedSourceSetRevision: '3' },
        })
      )
    );
    expect(selected.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const before = (
      await app.inject({ url: `/assets/${created.assetId}/sources`, headers })
    ).json();
    expect(before).toMatchObject({
      defaultSourceId: nextSource,
      sourceSetRevision: '4',
      deliveryRevision: '4',
    });
    // Fail the final state write after retirement has been attempted. Both must roll back.
    await pool.query(
      "ALTER TABLE asset_source_state ADD CONSTRAINT source_withdrawal_rollback CHECK (state->>'sourceSetRevision' <> '5')"
    );
    const withdraw = () =>
      app.inject({
        method: 'DELETE',
        url: `/assets/${created.assetId}/sources/${winner.sourceId}`,
        headers: { ...headers, 'x-correlation-id': 'withdrawal-intent' },
        payload: { expectedSourceSetRevision: '4' },
      });
    try {
      expect((await withdraw()).statusCode).toBe(503);
      expect(
        (await app.inject({ url: `/assets/${created.assetId}/sources`, headers })).json()
      ).toEqual(before);
      expect(
        (
          await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
            winner.sourceId,
          ])
        ).rows
      ).toEqual([{ evidence_expires_at: null }]);
      expect(
        (
          await app.inject({
            url: `/assets/${created.assetId}/sources/${winner.sourceId}/original`,
            headers,
          })
        ).rawPayload
      ).toEqual(replacementPng);
    } finally {
      await pool.query('ALTER TABLE asset_source_state DROP CONSTRAINT source_withdrawal_rollback');
    }
    expect((await withdraw()).json()).toEqual({
      defaultSourceId: nextSource,
      sourceSetRevision: '5',
      deliveryRevision: '5',
    });
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/${winner.sourceId}/original`,
          headers,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/assets/${created.assetId}/sources/${nextSource}/original`,
          headers,
        })
      ).rawPayload
    ).toEqual(png);
    const withdrawn = await pool.query(
      'SELECT evidence_expires_at FROM immutable_sources WHERE id = $1',
      [winner.sourceId]
    );
    expect(withdrawn.rows[0]?.evidence_expires_at).toBeInstanceOf(Date);
    const withdrawalContext = (
      await pool.query('SELECT context FROM source_cleanup WHERE id=$1', [
        `source:${winner.sourceId}`,
      ])
    ).rows[0]?.context;
    expect(withdrawalContext).toMatchObject({
      occurrence: { source: 'https://wallpaperdb/asset/authors', id: expect.any(String) },
      correlationId: 'withdrawal-intent',
    });
    expect((await withdraw()).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/assets/${created.assetId}/source-candidates/${winner.candidateId}/accept`,
          headers,
          payload: replacementIntent,
        })
      ).json()
    ).toMatchObject({ status: 'accepted', sourceSetRevision: '2' });
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
          winner.sourceId,
        ])
      ).rows
    ).toEqual(withdrawn.rows);
    expect(
      (
        await pool.query('SELECT state FROM asset_source_state WHERE asset_id = $1', [
          created.assetId,
        ])
      ).rows[0]?.state
    ).toMatchObject({
      sourceSetRevision: '5',
      deliveryRevision: '5',
      defaultSourceId: nextSource,
      initialAnalysisSourceId: sourceId,
      sources: [{ sourceId: nextSource }],
    });
    // Default/withdrawal are synchronous local mutations, not new candidate acceptance facts.
    const nextMessage = await consumer.next({ expires: 5000 });
    expect(nextMessage?.json()).toMatchObject({
      type: 'asset.source.accepted',
      data: {
        assetId: created.assetId,
        sourceId: nextSource,
        sourceSetRevision: '3',
        initialAnalysisSourceId: sourceId,
      },
    });
    nextMessage?.ack();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM source_acceptance_outbox WHERE confirmation->>'assetId' = $1",
          [created.assetId]
        )
      ).rows
    ).toEqual([{ count: 3 }]);
    expect(await publisher.runPromise(SourceConfirmationHealth.use((s) => s.check()))).toBe(true);
    // An Author has no full-Asset deletion route, even with a valid Owner identity.
    expect(
      (await app.inject({ method: 'DELETE', url: `/assets/${created.assetId}`, headers }))
        .statusCode
    ).toBe(404);
    const deleteInput = {
      revision: authority.identity,
      applicationId: 'wallpaper',
      canonical: 'terminal-http-delete',
      correlation: { commandId: 'terminal-http-delete', applicationReference: 'delete-wallpaper' },
      decision: {
        kind: 'delete' as const,
        assetId: created.assetId,
        evidenceRetentionMsByType: { wallpaper: 604800000 },
      },
      context: { occurrence: { source: 'https://test/wallpaper', id: 'delete-http-one' } },
    };
    await pool.query(
      'ALTER TABLE asset_deletions ADD CONSTRAINT composition_delete_rollback CHECK (false) NOT VALID'
    );
    try {
      await expect(
        lifecycle.runPromise(LifecycleStore.use((s) => s.accept(deleteInput)))
      ).rejects.toThrow();
      expect(
        (
          await app.inject({
            url: `/assets/${created.assetId}/sources/${nextSource}/original`,
            headers,
          })
        ).rawPayload
      ).toEqual(png);
      expect(
        (
          await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id=$1', [
            nextSource,
          ])
        ).rows
      ).toEqual([{ evidence_expires_at: null }]);
    } finally {
      await pool.query('ALTER TABLE asset_deletions DROP CONSTRAINT composition_delete_rollback');
    }
    expect(
      await lifecycle.runPromise(LifecycleStore.use((s) => s.accept(deleteInput)))
    ).toMatchObject({ outcome: 'deleted', assetId: created.assetId });
    expect(
      (await pool.query('SELECT context FROM source_cleanup WHERE id=$1', [`source:${nextSource}`]))
        .rows[0]?.context
    ).toEqual(deleteInput.context);
    expect(
      (
        await pool.query('SELECT context FROM source_cleanup WHERE id=$1', [
          `source:${winner.sourceId}`,
        ])
      ).rows[0]?.context
    ).toEqual(withdrawalContext);
    for (const request of [
      { method: 'GET' as const, url: `/assets/${created.assetId}/sources` },
      { method: 'GET' as const, url: `/assets/${created.assetId}/sources/${nextSource}/original` },
      {
        method: 'GET' as const,
        url: `/assets/${created.assetId}/source-candidates/${nextCandidate}`,
      },
      {
        method: 'DELETE' as const,
        url: `/assets/${created.assetId}/source-candidates/${nextCandidate}`,
      },
      {
        method: 'POST' as const,
        url: `/assets/${created.assetId}/source-candidates`,
        payload: addition,
      },
      {
        method: 'POST' as const,
        url: `/assets/${created.assetId}/source-candidates/${nextCandidate}/accept`,
        payload: addition,
      },
      {
        method: 'PUT' as const,
        url: `/assets/${created.assetId}/source-candidates/${nextCandidate}/bytes`,
        payload: png,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
      },
      {
        method: 'PUT' as const,
        url: `/assets/${created.assetId}/default-source`,
        payload: { sourceId: nextSource, expectedSourceSetRevision: '5' },
      },
      {
        method: 'DELETE' as const,
        url: `/assets/${created.assetId}/sources/${nextSource}`,
        payload: { expectedSourceSetRevision: '5' },
      },
    ])
      expect((await app.inject({ headers, ...request })).statusCode).toBe(404);
    const rawStorage = ManagedRuntime.make(bytes);
    try {
      const retained = await rawStorage.runPromise(
        SourceBytes.use((s) => s.read(nextSource, created.assetId))
      );
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of retained.bytes) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(png);
      } finally {
        await rawStorage.runPromise(retained.close());
      }
    } finally {
      await rawStorage.dispose();
    }
    const terminal = (
      await pool.query('SELECT state FROM asset_source_state WHERE asset_id=$1', [created.assetId])
    ).rows[0].state;
    expect(terminal).toMatchObject({
      sources: [],
      defaultSourceId: null,
      sourceSetRevision: '6',
      deliveryRevision: '6',
      initialAnalysisSourceId: sourceId,
      nonterminalCandidateCount: 0,
    });
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id=$1', [
          winner.sourceId,
        ])
      ).rows
    ).toEqual(withdrawn.rows);
    expect(
      await lifecycle.runPromise(LifecycleStore.use((s) => s.accept(deleteInput)))
    ).toMatchObject({ outcome: 'deleted' });
  } finally {
    await app.close();
    await publisher.dispose();
    await lifecycle.dispose();
  }
});

it('fences late upload and immutable preparation completion after terminal deletion', async () => {
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
  const storage = sourceStorageLayer({
    endpoint: s3.endpoints.fromHost,
    region: 'us-east-1',
    accessKeyId: s3.options.accessKey,
    secretAccessKey: s3.options.secretKey,
    bucket: 'composition-private',
  });
  let suspend: 'upload' | 'prepare' | null = null;
  let entered = () => {};
  let release = () => {};
  let resume: Promise<void> = Promise.resolve();
  const delayed = Layer.effect(
    SourceBytes,
    Effect.gen(function* () {
      const real = yield* SourceBytes;
      const pause = (phase: 'upload' | 'prepare') =>
        Effect.gen(function* () {
          if (suspend !== phase) return;
          entered();
          yield* Effect.promise(() => resume);
        });
      return SourceBytes.of({
        ...real,
        put: (...args) => real.put(...args).pipe(Effect.andThen(pause('upload'))),
        prepare: (...args) => real.prepare(...args).pipe(Effect.andThen(pause('prepare'))),
      });
    })
  ).pipe(Layer.provide(storage));
  const sources = ManagedRuntime.make(
    sourcesLayer({ revision: authority.identity, types: authority.assetTypes }).pipe(
      Layer.provide(Layer.mergeAll(persistence, storage, delayed))
    )
  );
  const owner = { namespace: 'clerk-test', subject: 'late-work-owner' };
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'green' } })
    .png()
    .toBuffer();
  const stream = () => ({
    async *[Symbol.asyncIterator]() {
      yield png;
    },
    cancel() {},
  });
  try {
    for (const phase of ['upload', 'prepare'] as const) {
      suspend = null;
      const created = await lifecycle.runPromise(
        LifecycleStore.use((s) =>
          s.accept({
            revision: authority.identity,
            applicationId: 'wallpaper',
            canonical: `late-create-${phase}`,
            correlation: { commandId: `late-create-${phase}`, applicationReference: '' },
            context: {
              occurrence: { source: 'https://test/wallpaper', id: `late-create-${phase}` },
            },
            decision: { kind: 'create', assetType: 'wallpaper', owner },
          })
        )
      );
      if (created.outcome !== 'created') throw new Error('Expected Asset');
      const assetId = created.assetId;
      const intent = { operation: 'add' as const, expectedSourceSetRevision: '0' };
      const candidate = await sources.runPromise(
        Sources.use((s) => s.create(owner, assetId, { ...intent, idempotencyKey: `late-${phase}` }))
      );
      if (candidate.kind !== 'candidate') throw new Error('Expected candidate');
      const id = candidate.candidate.candidateId;
      if (phase === 'prepare')
        expect(
          await sources.runPromise(Sources.use((s) => s.upload(owner, assetId, id, stream())))
        ).toMatchObject({ kind: 'candidate', candidate: { status: 'ready' } });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      suspend = phase;
      const pending = sources.runPromise(
        Sources.use((s) =>
          phase === 'upload'
            ? s.upload(owner, assetId, id, stream())
            : s.accept(owner, assetId, id, intent)
        )
      );
      try {
        await ready;
        expect(
          await lifecycle.runPromise(
            LifecycleStore.use((s) =>
              s.accept({
                revision: authority.identity,
                applicationId: 'wallpaper',
                canonical: `late-delete-${phase}`,
                correlation: { commandId: `late-delete-${phase}`, applicationReference: '' },
                context: {
                  occurrence: { source: 'https://test/wallpaper', id: `late-delete-${phase}` },
                },
                decision: {
                  kind: 'delete',
                  assetId,
                  evidenceRetentionMsByType: { wallpaper: 604800000 },
                },
              })
            )
          )
        ).toMatchObject({ outcome: 'deleted' });
      } finally {
        release();
      }
      expect(await pending).toEqual({ kind: 'unavailable' });
      expect(await sources.runPromise(Sources.use((s) => s.list(owner, assetId)))).toEqual({
        kind: 'unavailable',
      });
      expect(
        await sources.runPromise(Sources.use((s) => s.accept(owner, assetId, id, intent)))
      ).toEqual({ kind: 'unavailable' });
      expect(
        (await pool.query('SELECT state FROM asset_source_state WHERE asset_id=$1', [assetId]))
          .rows[0].state
      ).toMatchObject({
        sources: [],
        nonterminalCandidateCount: 0,
        candidates: [],
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM source_acceptance_outbox WHERE confirmation->>'assetId'=$1",
            [assetId]
          )
        ).rows
      ).toEqual([{ count: 0 }]);
      expect(
        (
          await pool.query(
            'SELECT candidate FROM source_candidates WHERE asset_id=$1 AND candidate_id=$2',
            [assetId, id]
          )
        ).rows[0]?.candidate
      ).toMatchObject({ candidateId: id, status: 'cancelled', reason: 'asset-deleted' });
      // The reserved candidate and Source destinations remain known for bounded cleanup.
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM asset_deletions WHERE asset_id=$1 AND cleanup_pending',
            [assetId]
          )
        ).rows
      ).toEqual([{ count: 1 }]);
    }
  } finally {
    release();
    await sources.dispose();
    await lifecycle.dispose();
  }
});
