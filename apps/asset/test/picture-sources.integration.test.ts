import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import sharp from 'sharp';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer, sourceStorageLayer } from '../src/adapters/sources/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import { SourceBytes, Sources, sourcesLayer } from '../src/capabilities/sources/index.js';
import { AuthorAuthentication } from '../src/adapters/authors/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { Availability } from '../src/capabilities/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
import { pictureAnimation } from './fixtures/animation.js';

const authority = parseAuthority(authorityFixture());
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('picture-source-private');
let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let pool: Pool;
beforeAll(async () => {
  await tester.setup();
  postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: postgres.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
}, 60000);
afterAll(async () => {
  await pool?.end();
  await postgres?.stop();
  await tester.destroy();
});

it('durably readies and accepts the recorded 1850-frame configured picture', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: postgres.getConnectionUri(),
      revision: authority.identity,
      ...authority.delivery,
      leaseMs: 1000,
    })
  );
  const s3 = tester.getS3();
  const storage = sourceStorageLayer({
    endpoint: s3.endpoints.fromHost,
    region: 'us-east-1',
    accessKeyId: s3.options.accessKey,
    secretAccessKey: s3.options.secretKey,
    bucket: 'picture-source-private',
  });
  const runtime = ManagedRuntime.make(
    sourcesLayer({
      revision: authority.identity,
      types: {
        ...authority.assetTypes,
        picture: {
          ...authority.assetTypes.picture,
          admission: { ...authority.assetTypes.picture.admission, squareSize: 1 },
        },
      },
    }).pipe(
      Layer.provide(
        Layer.merge(
          storage,
          sourcePostgresLayer({
            databaseUrl: postgres.getConnectionUri(),
            ...authority.delivery,
            leaseMs: 1000,
          })
        )
      )
    )
  );
  const owner = { namespace: 'clerk-test', subject: 'animation-owner' };
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: authority.identity,
          applicationId: 'user',
          canonical: 'animation-1850',
          correlation: { commandId: 'animation-1850', applicationReference: 'animation-1850' },
          decision: { kind: 'create', assetType: 'picture', owner },
          context: { occurrence: { source: 'https://test/user', id: 'animation-1850' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected picture');
    const intent = {
      operation: 'add',
      expectedSourceSetRevision: '0',
      idempotencyKey: 'animation-1850',
    } as const;
    const proposed = await runtime.runPromise(
      Sources.use((s) => s.create(owner, created.assetId, intent))
    );
    if (proposed.kind !== 'candidate') throw new Error('Expected candidate');
    const id = proposed.candidate.candidateId;
    const bytes = await pictureAnimation();
    const upload = {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
      cancel() {},
    };
    const uploaded = await runtime.runPromise(
      Sources.use((s) => s.upload(owner, created.assetId, id, upload)).pipe(Effect.exit)
    );
    const result = await runtime.runPromise(
      Sources.use((s) => s.status(owner, created.assetId, id))
    );
    expect(result).toMatchObject({
      kind: 'candidate',
      candidate: {
        status: 'ready',
        facts: { animation: { frames: 1850, loop: 0, delaysMs: Array(1850).fill(10000000) } },
      },
    });
    expect(uploaded).toMatchObject({ _tag: 'Success', value: result });
    expect(
      await runtime.runPromise(Sources.use((s) => s.accept(owner, created.assetId, id, intent)))
    ).toMatchObject({ kind: 'candidate', candidate: { status: 'accepted' } });
    expect(
      await runtime.runPromise(Sources.use((s) => s.status(owner, created.assetId, id)))
    ).toMatchObject({ kind: 'candidate', candidate: { status: 'accepted' } });
  } finally {
    await runtime.dispose();
    await lifecycle.dispose();
  }
});

it('replaces a canonical picture through Owner HTTP with atomic retirement, rollback, immutable bytes and explicit conflict retry', async () => {
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
    bucket: 'picture-source-private',
  });
  const services = sourcesLayer({ revision: authority.identity, types: authority.assetTypes }).pipe(
    Layer.provide(Layer.merge(persistence, bytes))
  );
  const sourceRuntime = ManagedRuntime.make(Layer.merge(services, bytes));
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
        services,
        Layer.succeed(AuthorAuthentication, {
          verify: (token) =>
            Effect.succeed(
              token === 'Bearer owner'
                ? { namespace: 'clerk-test', subject: 'owner' }
                : token === 'Bearer stranger'
                  ? { namespace: 'clerk-test', subject: 'stranger' }
                  : null
            ),
        })
      ),
    }
  );
  const headers = { authorization: 'Bearer owner' };
  const image = (color: string) =>
    sharp({ create: { width: 512, height: 512, channels: 4, background: color } })
      .webp()
      .toBuffer();
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: authority.identity,
          applicationId: 'user',
          canonical: 'picture-http',
          correlation: { commandId: 'picture-http', applicationReference: 'picture-intent' },
          decision: {
            kind: 'create',
            assetType: 'picture',
            owner: { namespace: 'clerk-test', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/user', id: 'create-picture-http' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected picture Asset');
    const base = `/assets/${created.assetId}`;
    const propose = async (
      key: string,
      operation: 'add' | 'replace-set',
      revision: string,
      input: Buffer
    ) => {
      const intent = { operation, expectedSourceSetRevision: revision };
      const candidate = await app.inject({
        method: 'POST',
        url: `${base}/source-candidates`,
        headers: { ...headers, 'idempotency-key': key },
        payload: intent,
      });
      expect(candidate.statusCode).toBe(201);
      const id = candidate.json<{ candidateId: string }>().candidateId;
      const uploaded = await app.inject({
        method: 'PUT',
        url: `${base}/source-candidates/${id}/bytes`,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        payload: input,
      });
      expect(uploaded.json()).toMatchObject({ status: 'ready' });
      return { id, intent };
    };
    const accept = (candidate: Awaited<ReturnType<typeof propose>>) =>
      app.inject({
        method: 'POST',
        url: `${base}/source-candidates/${candidate.id}/accept`,
        headers,
        payload: candidate.intent,
      });
    const listed = async () => (await app.inject({ url: `${base}/sources`, headers })).json();
    const original = (id: string) => app.inject({ url: `${base}/sources/${id}/original`, headers });
    const initialBytes = await image('red');
    const initial = await propose('initial', 'add', '0', initialBytes);
    const first = await accept(initial);
    expect(first.statusCode).toBe(200);
    const firstSource = first.json<{ sourceId: string }>().sourceId;
    expect((await original(firstSource)).rawPayload).toEqual(initialBytes);
    const newBytes = await image('blue');
    const editA = await propose('edit-a', 'replace-set', '1', newBytes);
    const editB = await propose('edit-b', 'replace-set', '1', await image('green'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/source-candidates/${editA.id}/accept`,
          headers: { authorization: 'Bearer stranger' },
          payload: editA.intent,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/source-candidates/${editA.id}/accept`,
          payload: editA.intent,
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/source-candidates/${editA.id}/accept`,
          headers,
          payload: { ...editA.intent, operation: 'add' },
        })
      ).json()
    ).toMatchObject({ status: 409, title: 'candidate intent conflict' });
    const before = await listed();
    await pool.query(
      "ALTER TABLE asset_source_state ADD CONSTRAINT picture_rollback CHECK (state->>'sourceSetRevision' <> '2')"
    );
    try {
      expect((await accept(editA)).statusCode).toBe(503);
      expect(await listed()).toEqual(before);
      expect(
        (
          await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id=$1', [
            firstSource,
          ])
        ).rows
      ).toEqual([{ evidence_expires_at: null }]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM source_acceptance_outbox WHERE confirmation->>'assetId'=$1",
            [created.assetId]
          )
        ).rows
      ).toEqual([{ count: 1 }]);
      expect((await original(firstSource)).rawPayload).toEqual(initialBytes);
    } finally {
      await pool.query('ALTER TABLE asset_source_state DROP CONSTRAINT picture_rollback');
    }
    const acceptanceStartedAt = Date.now();
    const results = await Promise.all([accept(editA), accept(editB)]);
    const acceptanceCompletedAt = Date.now();
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winningIndex = results.findIndex((r) => r.statusCode === 200);
    const winning = results[winningIndex]!.json<{ sourceId: string }>();
    const winner = winningIndex === 0 ? editA : editB;
    const loser = winningIndex === 0 ? editB : editA;
    const winningBytes = winningIndex === 0 ? newBytes : await image('green');
    expect(await listed()).toMatchObject({
      assetId: created.assetId,
      sourceSetRevision: '2',
      deliveryRevision: '2',
      defaultSourceId: winning.sourceId,
      sources: [{ sourceId: winning.sourceId }],
    });
    expect((await original(firstSource)).statusCode).toBe(404);
    expect((await original(winning.sourceId)).rawPayload).toEqual(winningBytes);
    const retirement = (
      await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id=$1', [
        firstSource,
      ])
    ).rows;
    const deadline = retirement[0]?.evidence_expires_at;
    expect(deadline).toBeInstanceOf(Date);
    expect(deadline.getTime()).toBeGreaterThanOrEqual(
      acceptanceStartedAt + authority.assetTypes.picture.retention.evidenceMs
    );
    expect(deadline.getTime()).toBeLessThanOrEqual(
      acceptanceCompletedAt + authority.assetTypes.picture.retention.evidenceMs
    );
    expect(
      (await pool.query('SELECT due_at FROM source_cleanup WHERE id=$1', [`source:${firstSource}`]))
        .rows
    ).toEqual([{ due_at: deadline }]);
    expect((await accept(initial)).statusCode).toBe(200);
    expect((await accept(winner)).statusCode).toBe(200);
    expect((await accept(loser)).statusCode).toBe(409);
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id=$1', [
          firstSource,
        ])
      ).rows
    ).toEqual(retirement);
    expect(
      (
        await pool.query('SELECT confirmation FROM source_acceptance_outbox WHERE id=$1', [
          `source-accepted:${winning.sourceId}`,
        ])
      ).rows[0]?.confirmation
    ).toMatchObject({
      applicationId: 'user',
      assetId: created.assetId,
      initialAnalysisSourceId: firstSource,
      sourceSetRevision: '2',
      deliveryRevision: '2',
    });
    // Retained evidence bytes are accessible only through the private storage port, never active membership.
    await sourceRuntime.runPromise(
      SourceBytes.use((storage) =>
        Effect.gen(function* () {
          const retained = yield* storage.read(firstSource, created.assetId);
          const chunks = yield* Effect.promise(async () => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of retained.bytes) chunks.push(chunk);
            return chunks;
          });
          yield* retained.close();
          expect(Buffer.concat(chunks)).toEqual(initialBytes);
        })
      )
    );
    expect(
      await sourceRuntime.runPromise(
        Sources.use((sources) =>
          sources.original(
            { namespace: 'clerk-test', subject: 'owner' },
            created.assetId,
            firstSource
          )
        )
      )
    ).toEqual({ kind: 'unavailable' });
    // An actual storage preparation failure must not replace the winner.
    const retry = await propose('explicit-retry', 'replace-set', '2', newBytes);
    const client = new S3Client({
      endpoint: s3.endpoints.fromHost,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: s3.options.accessKey, secretAccessKey: s3.options.secretKey },
    });
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'picture-source-private',
          Key: `asset-layout-1/private/candidates/${retry.id}/input`,
        })
      );
    } finally {
      client.destroy();
    }
    expect((await accept(retry)).statusCode).toBe(503);
    expect((await original(winning.sourceId)).rawPayload).toEqual(winningBytes);
    expect(await listed()).toMatchObject({
      sourceSetRevision: '2',
      sources: [{ sourceId: winning.sourceId }],
    });
    for (const id of [loser.id, retry.id])
      expect(
        (await app.inject({ method: 'DELETE', url: `${base}/source-candidates/${id}`, headers }))
          .statusCode
      ).toBe(200);
    const invalidInputs = [
      {
        key: 'png',
        input: await sharp(initialBytes).png().toBuffer(),
        reason: 'unsupported-source-model',
      },
      {
        key: 'jpeg',
        input: await sharp(initialBytes).jpeg().toBuffer(),
        reason: 'unsupported-source-model',
      },
      {
        key: 'small-square',
        input: await sharp(initialBytes).resize(256, 256).webp().toBuffer(),
        reason: 'noncanonical-picture',
      },
      {
        key: 'oversized-axis',
        input: await sharp(initialBytes).resize(513, 512).webp().toBuffer(),
        reason: 'geometry-limit',
      },
      {
        key: 'private-metadata',
        input: await sharp(initialBytes)
          .withExif({ IFD0: { Artist: 'private' } })
          .webp()
          .toBuffer(),
        reason: 'noncanonical-picture',
      },
      { key: 'invalid-bytes', input: Buffer.from('not an image'), reason: 'invalid-image' },
    ];
    for (const invalid of invalidInputs) {
      const proposed = await app.inject({
        method: 'POST',
        url: `${base}/source-candidates`,
        headers: { ...headers, 'idempotency-key': invalid.key },
        payload: { operation: 'replace-set', expectedSourceSetRevision: '2' },
      });
      expect(proposed.statusCode).toBe(201);
      const id = proposed.json<{ candidateId: string }>().candidateId;
      const result = await app.inject({
        method: 'PUT',
        url: `${base}/source-candidates/${id}/bytes`,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        payload: invalid.input,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ status: 'rejected', reason: invalid.reason });
      expect((await original(winning.sourceId)).rawPayload).toEqual(winningBytes);
    }
    const tooLarge = await app.inject({
      method: 'POST',
      url: `${base}/source-candidates`,
      headers: { ...headers, 'idempotency-key': 'encoded-size' },
      payload: { operation: 'replace-set', expectedSourceSetRevision: '2' },
    });
    const tooLargeId = tooLarge.json<{ candidateId: string }>().candidateId;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `${base}/source-candidates/${tooLargeId}/bytes`,
          headers: { ...headers, 'content-type': 'application/octet-stream' },
          payload: Buffer.alloc(5242881),
        })
      ).json()
    ).toMatchObject({ status: 413, title: 'encoded size limit' });
    await app.inject({ method: 'DELETE', url: `${base}/source-candidates/${tooLargeId}`, headers });
    const gif = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030102000021f904010a0000002c000000000100010000020244010021f90401140000002c00000000010001000002024c01003b',
      'hex'
    );
    const animation = await sharp(gif, { animated: true })
      .resize(512, 512, { fit: 'fill' })
      .webp()
      .toBuffer();
    const animatedRetry = await propose('retry-animation', 'replace-set', '2', animation);
    expect((await accept(animatedRetry)).json()).toMatchObject({
      status: 'accepted',
      sourceSetRevision: '3',
    });
    const current = await listed();
    expect(current.sources).toHaveLength(1);
    expect(current.sources[0].facts).toMatchObject({
      model: 'animated-sdr-webp',
      animation: { frames: 2, loop: 3, delaysMs: [100, 200] },
    });
    expect((await original(current.sources[0].sourceId)).rawPayload).toEqual(animation);
  } finally {
    await app.close();
    await sourceRuntime.dispose();
    await lifecycle.dispose();
  }
});
