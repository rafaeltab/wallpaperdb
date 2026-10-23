import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect } from 'nats';
import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { parseAuthority } from '../src/authority.js';
import {
  operatorWebhookLayer,
  OperatorNotificationHealth,
  provisionAssetBroker,
  renderBrokerConfiguration,
} from '../src/adapters/commands/index.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import {
  sourceConfirmationsLayer,
  SourceConfirmationHealth,
  sourcePostgresLayer,
} from '../src/adapters/sources/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import {
  SourceAcceptanceOutbox,
  SourceFailure,
  SourceStore,
  type SourceConfirmation,
  type SourceConfirmationAlert,
  type SourcePublication,
} from '../src/capabilities/sources/index.js';
import { authorityFixture } from './fixtures/authority.js';

it('routes each renewed Source quarantine to the durable operator inbox while preserving the recovered confirmation identity', async () => {
  const authority = parseAuthority(authorityFixture());
  const cleanups: Array<() => Promise<unknown>> = [];
  const cleanupFailures: unknown[] = [];
  try {
    const directory = await mkdtemp(join(tmpdir(), 'source-quarantine-receipts-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const { createOperatorInbox } = await import(
      new URL('../../../scripts/operator-inbox.mjs', import.meta.url).href
    );
    const server: Server = await createOperatorInbox({ directory, token: 'operator-inbox-token' });
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing operator address');
    const received = async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/receipts`, {
        headers: {
          authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
        },
      });
      expect(response.status).toBe(200);
      return z
        .array(
          z.object({
            notice: z.object({ id: z.string() }).passthrough(),
            receivedAt: z.string(),
          })
        )
        .parse(await response.json());
    };
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    cleanups.push(() => postgres.stop());
    const pool = new Pool({ connectionString: postgres.getConnectionUri() });
    cleanups.push(() => pool.end());
    const broker = await new GenericContainer('nats:2.10-alpine')
      .withCopyContentToContainer([
        { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
      ])
      .withCommand(['-c', '/etc/nats/asset.conf'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage('Server is ready'))
      .start();
    cleanups.push(() => broker.stop());
    const url = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
    const operator = await connect({
      servers: url,
      user: 'asset-operator_wallpaper',
      pass: authority.broker.operator.password,
    });
    cleanups.push(() => operator.close());
    const application = await connect({
      servers: url,
      user: 'wallpaper-1',
      pass: 'wallpaper-secret',
      inboxPrefix: '_ASSET_INBOX.wallpaper',
    });
    cleanups.push(() => application.close());
    const delivery = { ...authority.delivery, retryDelayMs: 10, pollMs: 10, leaseMs: 1000 };
    const lifecycle = ManagedRuntime.make(
      lifecyclePostgresLayer({
        databaseUrl: postgres.getConnectionUri(),
        revision: authority.identity,
        ...delivery,
      })
    );
    cleanups.push(() => lifecycle.dispose());
    const sources = ManagedRuntime.make(
      sourcePostgresLayer({ databaseUrl: postgres.getConnectionUri(), ...delivery })
    );
    cleanups.push(() => sources.dispose());
    const wallpaper = authority.applications.wallpaper;
    if (!wallpaper) throw new Error('Missing Wallpaper application');
    const applications = { wallpaper };
    const notifications = ManagedRuntime.make(
      operatorWebhookLayer({
        url,
        credential: authority.broker.service,
        applications,
        target: { url: `http://127.0.0.1:${address.port}/events`, token: 'operator-inbox-token' },
        ...delivery,
      })
    );
    cleanups.push(() => notifications.dispose());
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
    await provisionAssetBroker(operator, authority, 'wallpaper');
    const manager = await operator.jetstreamManager();
    const originalConfig = (await manager.streams.info('ASSET_RESULTS')).config;
    await manager.streams.update('ASSET_RESULTS', { max_msg_size: 128 });
    await notifications.runPromise(OperatorNotificationHealth);
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: authority.identity,
          applicationId: 'wallpaper',
          canonical: 'source-publication-recovery',
          correlation: { commandId: 'create-recovery', applicationReference: 'recovery-intent' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk-test', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'create-recovery' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const confirmation: SourceConfirmation = {
      id: 'source-accepted:source_recovery',
      applicationId: 'wallpaper',
      assetId: created.assetId,
      assetType: 'wallpaper',
      candidateId: 'candidate_recovery',
      sourceId: 'source_recovery',
      sourceSetRevision: '1',
      deliveryRevision: '1',
      defaultSourceId: 'source_recovery',
      initialAnalysisSourceId: 'source_recovery',
      context: {
        occurrence: { source: 'https://test/author', id: 'accept-recovery' },
        correlationId: 'recovery-intent',
      },
    };
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(created.assetId, authority.identity, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [
            {
              sourceId: confirmation.sourceId,
              layout: 'asset-layout-1',
              facts: {
                digest: 'a'.repeat(64),
                byteLength: 4,
                width: 2,
                height: 2,
                model: 'sdr-png',
                mimeType: 'image/png',
              },
            },
          ];
          state.defaultSourceId = confirmation.sourceId;
          state.initialAnalysisSourceId = confirmation.sourceId;
          state.sourceSetRevision = '1';
          state.deliveryRevision = '1';
          return { state, result: undefined, confirmation };
        })
      )
    );
    const outbox = await sources.runPromise(SourceAcceptanceOutbox);
    const failures: SourcePublication[] = [];
    const completed: SourcePublication[] = [];
    const alerts: SourceConfirmationAlert[] = [];
    let failAcknowledgement = true;
    const startPublisher = () => {
      const runtime = ManagedRuntime.make(
        sourceConfirmationsLayer({
          url,
          credential: authority.broker.service,
          applications,
          ...delivery,
        }).pipe(
          Layer.provide(
            Layer.succeed(SourceAcceptanceOutbox, {
              ...outbox,
              alerted: (alert) =>
                Effect.suspend(() => {
                  alerts.push(alert);
                  // The broker accepted the notice, but recording its completion failed.
                  if (failAcknowledgement) {
                    failAcknowledgement = false;
                    return Effect.fail(
                      new SourceFailure({
                        operation: 'confirm-alert',
                        cause: 'lost acknowledgement',
                      })
                    );
                  }
                  return outbox.alerted(alert);
                }),
              published: (publication) =>
                outbox.published(publication).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      completed.push(publication);
                    })
                  )
                ),
              failed: (publication) =>
                Effect.sync(() => {
                  failures.push(publication);
                }).pipe(Effect.andThen(outbox.failed(publication))),
            })
          )
        )
      );
      cleanups.push(() => runtime.dispose());
      return runtime;
    };
    const publisher = startPublisher();
    await publisher.runPromise(SourceConfirmationHealth);
    const receipt = expect.objectContaining({
      notice: {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        kind: 'source-confirmation-quarantine',
        subject: 'asset.results.wallpaper',
        reason: 'exhausted',
        context: confirmation.context,
        applicationId: 'wallpaper',
      },
    });
    await expect.poll(received, { timeout: 5000 }).toEqual([receipt]);
    await expect.poll(() => sources.runPromise(outbox.pendingAlerts())).toEqual([]);
    await publisher.dispose();
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(alerts[1]).toEqual(alerts[0]);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(1);
    expect(failures.map((publication) => publication.attempts)).toEqual([1, 2, 3]);
    expect(failures.every((publication) => publication.confirmation.id === confirmation.id)).toBe(
      true
    );
    expect(new Set(failures.map((publication) => publication.occurredAt)).size).toBe(1);
    expect((await manager.streams.info('ASSET_RESULTS')).state.messages).toBe(0);
    const firstReceipt = (await received())[0];
    expect(await sources.runPromise(outbox.recover(confirmation.id))).toBe(true);
    const renewed = startPublisher();
    await renewed.runPromise(SourceConfirmationHealth);
    await expect.poll(received, { timeout: 5000 }).toEqual([receipt, receipt]);
    await expect.poll(() => sources.runPromise(outbox.pendingAlerts())).toEqual([]);
    await renewed.dispose();
    const receipts = await received();
    expect(receipts[0]).toEqual(firstReceipt);
    expect(receipts[1]?.notice.id).not.toBe(receipts[0]?.notice.id);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(2);
    expect(failures.map((publication) => publication.attempts)).toEqual([1, 2, 3, 1, 2, 3]);
    await manager.streams.update('ASSET_RESULTS', originalConfig);
    expect(await sources.runPromise(outbox.claim(10))).toEqual([]);
    expect(await sources.runPromise(outbox.recover(confirmation.id))).toBe(true);
    const recovered = startPublisher();
    await recovered.runPromise(SourceConfirmationHealth);
    const consumer = await application
      .jetstream()
      .consumers.get('ASSET_RESULTS', 'results_wallpaper');
    const message = await consumer.next({ expires: 5000 });
    expect(message?.json()).toMatchObject({
      id: confirmation.id,
      type: 'asset.source.accepted',
      time: failures[0]?.occurredAt,
      causationid: 'accept-recovery',
      correlationid: 'recovery-intent',
      data: {
        assetId: created.assetId,
        sourceId: 'source_recovery',
        candidateId: 'candidate_recovery',
        sourceSetRevision: '1',
        deliveryRevision: '1',
        defaultSourceId: 'source_recovery',
        initialAnalysisSourceId: 'source_recovery',
      },
    });
    message?.ack();
    await expect
      .poll(() => completed, { timeout: 5000 })
      .toEqual([
        expect.objectContaining({
          id: confirmation.id,
          confirmation,
          attempts: 1,
          occurredAt: failures[0]?.occurredAt,
        }),
      ]);
    await expect
      .poll(() => recovered.runPromise(SourceConfirmationHealth.use((health) => health.check())))
      .toBe(true);
    await recovered.dispose();
    expect(await sources.runPromise(outbox.claim(10))).toEqual([]);
    expect(await sources.runPromise(outbox.recover(confirmation.id))).toBe(false);
    expect((await manager.streams.info('ASSET_RESULTS')).state.messages).toBe(1);
    expect(await received()).toHaveLength(2);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
  expect(cleanupFailures).toEqual([]);
});
