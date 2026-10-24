import { access, rm, writeFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  cleanupPostgresLayer,
  cleanupWorkerLayer,
  CleanupHealth,
} from '../src/adapters/cleanup/index.js';
import { CleanupBytes, CleanupFailure, cleanupLayer } from '../src/capabilities/cleanup/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import { SourceStore } from '../src/capabilities/sources/index.js';
import {
  operatorWebhookLayer,
  OperatorNotificationHealth,
} from '../src/adapters/commands/index.js';
import { runOperator } from '../scripts/operator.js';
import { withCleanupOperationsFixture } from './fixtures/cleanup-operations.js';

it('routes exhausted cleanup to the authenticated operator inbox and resumes only deliberate trusted recovery', async () => {
  const received: { kind: string; applicationId: string; subject: string; context?: unknown }[] =
    [];
  const origin = {
    occurrence: { source: 'https://test/asset/author', id: 'candidate-origin' },
    correlationId: 'cleanup-origin',
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    tracestate: 'vendor=cleanup',
  };
  await withCleanupOperationsFixture(
    async (request, response) => {
      if (request.headers.authorization !== 'Bearer operator-inbox-token') {
        response.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200).end();
    },
    async ({
      address,
      raw,
      authority,
      postgres,
      pool,
      url,
      directory,
      options,
      lifecycle,
      sources,
      ownWorker,
    }) => {
      const created = await lifecycle.runPromise(
        LifecycleStore.use((store) =>
          store.accept({
            revision: authority.identity,
            applicationId: 'wallpaper',
            canonical: 'cleanup-notice',
            correlation: { commandId: 'cleanup-notice', applicationReference: '' },
            decision: {
              kind: 'create',
              assetType: 'wallpaper',
              owner: { namespace: 'clerk-test', subject: 'owner' },
            },
            context: { occurrence: { source: 'https://test/wallpaper', id: 'create' } },
          })
        )
      );
      if (created.outcome !== 'created') throw new Error('Expected Asset');
      await sources.runPromise(
        SourceStore.use((store) =>
          store.transact(created.assetId, null, (state) => {
            if (!state) throw new Error('Expected Asset');
            state.candidates = [
              {
                candidateId: 'candidate_notice',
                sourceId: 'source_notice',
                idempotencyKey: 'notice',
                operation: 'add',
                expectedSourceSetRevision: '0',
                status: 'cancelled',
                context: origin,
                layout: 'asset-layout-1',
                expiresAt: '2000-01-01T00:00:00Z',
                orphanExpiresAt: '2000-01-01T00:00:00Z',
              },
            ];
            return { state, result: undefined };
          })
        )
      );
      await sources.dispose();
      let failing = true,
        calls = 0;
      const persistence = cleanupPostgresLayer(options);
      const capability = cleanupLayer.pipe(
        Layer.provide(
          Layer.merge(
            persistence,
            Layer.succeed(CleanupBytes, {
              reclaim: () =>
                Effect.suspend(() => {
                  calls++;
                  return failing
                    ? Effect.fail(
                        new CleanupFailure({
                          operation: 'fixture-outage',
                          cause: 'controlled dependency outage',
                        })
                      )
                    : Effect.void;
                }),
            })
          )
        )
      );
      const commandOptions = {
        url,
        credential: authority.broker.service,
        applications: authority.applications,
        ...authority.delivery,
      };
      const runtime = ManagedRuntime.make(
        Layer.merge(
          cleanupWorkerLayer(commandOptions).pipe(
            Layer.provide(Layer.merge(capability, persistence))
          ),
          operatorWebhookLayer({
            ...commandOptions,
            target: {
              url: `http://127.0.0.1:${address.port}/events`,
              token: authority.operatorNotification.token,
            },
          })
        )
      );
      ownWorker(() => runtime.dispose());
      await runtime.runPromise(CleanupHealth);
      await runtime.runPromise(OperatorNotificationHealth);
      await expect.poll(() => received.length, { timeout: 5000 }).toBe(2);
      expect(
        received.every(
          (notice) => notice.kind === 'cleanup-quarantine' && notice.applicationId === 'wallpaper'
        )
      ).toBe(true);
      expect(received.map((notice) => notice.context)).toEqual([origin, origin]);
      expect(received.map((notice) => notice.subject).sort()).toEqual([
        'asset.cleanup.candidate:candidate_notice',
        'asset.cleanup.source:source_notice',
      ]);
      expect(calls).toBe(4);
      const quarantined = (
        await pool.query('SELECT id, status, due_at FROM source_cleanup ORDER BY id')
      ).rows;
      expect(quarantined.every((row) => row.status === 'quarantined')).toBe(true);
      const path = join(directory, 'authority.json');
      await writeFile(path, JSON.stringify(raw), { mode: 0o600 });
      process.env.DATABASE_URL = postgres.getConnectionUri();
      for (const row of quarantined)
        expect(
          await runOperator(['recover-cleanup', '--id', row.id, '--authority-file', path])
        ).toEqual({ recovered: true });
      await expect.poll(() => received.length, { timeout: 5000 }).toBe(4);
      expect(received.slice(2).map((notice) => notice.context)).toEqual([origin, origin]);
      expect(calls).toBe(8);
      failing = false;
      for (const row of quarantined)
        expect(
          await runOperator(['recover-cleanup', '--id', row.id, '--authority-file', path])
        ).toEqual({ recovered: true });
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS count FROM source_cleanup WHERE status <> 'completed'"
              )
            ).rows[0].count,
          { timeout: 5000 }
        )
        .toBe(0);
      expect(calls).toBe(10);
      expect((await pool.query('SELECT due_at FROM source_cleanup ORDER BY id')).rows).toEqual(
        quarantined.map((row) => ({ due_at: row.due_at }))
      );
    }
  );
});

it('fixture closes its already listening inbox when PostgreSQL acquisition is interrupted', async () => {
  const setupFailure = new Error('controlled failure before PostgreSQL startup');
  let listener: Server | undefined;
  let actual: unknown;
  try {
    await withCleanupOperationsFixture(
      (_request, response) => response.end(),
      async () => {
        throw new Error('Unexpected completed setup');
      },
      {
        afterListener: async (server) => {
          listener = server;
          throw setupFailure;
        },
      }
    );
  } catch (error) {
    actual = error;
  }
  try {
    expect(actual).toBe(setupFailure);
    expect(listener).toBeDefined();
    expect(listener?.listening).toBe(false);
  } finally {
    // Compensate the intentionally reproduced old leak, even when assertions fail.
    if (listener?.listening) {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        listener?.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
});

type Fixture = Parameters<Parameters<typeof withCleanupOperationsFixture>[1]>[0];
async function assertReleased(fixture: Fixture) {
  expect(fixture.server.listening).toBe(false);
  expect(fixture.pool.ended).toBe(true);
  expect(fixture.connections.every((connection) => connection.isClosed())).toBe(true);
  await expect(access(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fixture.broker.exec(['true'])).rejects.toThrow(/not running|No such container/);
  await expect(fixture.postgres.exec(['true'])).rejects.toThrow(/not running|No such container/);
  await expect(fixture.lifecycle.runPromise(LifecycleStore)).rejects.toThrow(/disposed/);
  await expect(fixture.sources.runPromise(SourceStore)).rejects.toThrow(/disposed/);
}
async function compensate(fixture: Fixture) {
  // Independent safety cleanup owns only resources supplied by this invocation.
  const results = await Promise.allSettled([
    fixture.sources.dispose(),
    fixture.lifecycle.dispose(),
    ...fixture.connections.map((connection) => connection.close()),
    ...(fixture.pool.ended ? [] : [fixture.pool.end()]),
    fixture.broker.stop(),
    fixture.postgres.stop(),
    rm(fixture.directory, { recursive: true, force: true }),
    new Promise<void>((resolve, reject) => {
      if (!fixture.server.listening) return resolve();
      fixture.server.closeAllConnections();
      fixture.server.close((error) => (error ? reject(error) : resolve()));
    }),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (failures.length)
    throw new AggregateError(failures, 'Cleanup lifetime proof compensation failed');
}

it('fixture unwinds partial acquisition and preserves setup and teardown failures together', async () => {
  const setupFailure = new Error('controlled failure after resource acquisition');
  const teardownFailure = new Error('controlled listener release rejection');
  const previous = process.env.DATABASE_URL;
  let captured: Fixture | undefined;
  let actual: unknown;
  try {
    await withCleanupOperationsFixture(
      (_request, response) => response.end(),
      async () => {
        throw new Error('Unexpected completed setup');
      },
      {
        afterAcquisition: async (fixture) => {
          captured = fixture;
          // Materialize a real PostgreSQL client before the controlled setup failure.
          await fixture.pool.query('SELECT 1');
          process.env.DATABASE_URL = fixture.postgres.getConnectionUri();
          throw setupFailure;
        },
        closeServer: async (server) => {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          );
          throw teardownFailure;
        },
      }
    );
  } catch (error) {
    actual = error;
  }
  try {
    expect(actual).toBeInstanceOf(AggregateError);
    if (!(actual instanceof AggregateError))
      throw new Error('Expected retained setup and teardown causes');
    expect(actual.errors).toEqual([setupFailure, teardownFailure]);
    expect(process.env.DATABASE_URL).toBe(previous);
    expect(captured).toBeDefined();
    if (captured) await assertReleased(captured);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    if (captured) await compensate(captured);
  }
});

it('fixture attempts remaining releases after connection teardown fails and preserves the test failure', async () => {
  const testFailure = new Error('controlled test failure after protected broker provisioning');
  const teardownFailure = new Error('controlled broker client release rejection');
  const previous = process.env.DATABASE_URL;
  let captured: Fixture | undefined;
  let workerReleased = false;
  let actual: unknown;
  try {
    await withCleanupOperationsFixture(
      (_request, response) => response.end(),
      async (fixture) => {
        captured = fixture;
        await fixture.lifecycle.runPromise(LifecycleStore);
        await fixture.sources.runPromise(SourceStore);
        const runtime = ManagedRuntime.make(
          operatorWebhookLayer({
            url: fixture.url,
            credential: fixture.authority.broker.service,
            applications: fixture.authority.applications,
            ...fixture.authority.delivery,
            target: {
              url: `http://127.0.0.1:${fixture.address.port}/events`,
              token: fixture.authority.operatorNotification.token,
            },
          })
        );
        fixture.ownWorker(async () => {
          await runtime.dispose();
          workerReleased = true;
        });
        await runtime.runPromise(OperatorNotificationHealth);
        process.env.DATABASE_URL = fixture.postgres.getConnectionUri();
        throw testFailure;
      },
      {
        closeConnection: async (connection) => {
          await connection.close();
          throw teardownFailure;
        },
      }
    );
  } catch (error) {
    actual = error;
  }
  try {
    expect(actual).toBeInstanceOf(AggregateError);
    if (!(actual instanceof AggregateError))
      throw new Error('Expected retained test and teardown causes');
    expect(actual.errors).toEqual([testFailure, teardownFailure, teardownFailure]);
    expect(process.env.DATABASE_URL).toBe(previous);
    expect(workerReleased).toBe(true);
    expect(captured).toBeDefined();
    if (captured) await assertReleased(captured);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    if (captured) await compensate(captured);
  }
});
