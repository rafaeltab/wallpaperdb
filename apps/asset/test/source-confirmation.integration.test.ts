import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  recoverQuarantine,
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

const exec = promisify(execFile);

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
    async function startReceiver() {
      const server: Server = await createOperatorInbox({
        directory,
        token: 'operator-inbox-token',
      });
      const stop = async () => {
        if (!server.listening) return;
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      };
      cleanups.push(stop);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing operator address');
      return { stop, url: `http://127.0.0.1:${address.port}` };
    }
    let receiver = await startReceiver();
    // Controlled HTTP rejection leaves the real broker and operator route available.
    let rejectHttp = true;
    let httpFailures = 0;
    const forwarder = createServer(async (request, response) => {
      try {
        if (rejectHttp) {
          httpFailures++;
          response.writeHead(503).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const forwarded = await fetch(`${receiver.url}/events`, {
          method: 'POST',
          headers: { authorization: request.headers.authorization ?? '' },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(1000),
        });
        await forwarded.body?.cancel();
        response.writeHead(forwarded.status).end();
      } catch (error) {
        cleanupFailures.push(error);
        response.writeHead(503).end();
      }
    });
    cleanups.push(async () => {
      forwarder.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        forwarder.close((error) => (error ? reject(error) : resolve()))
      );
    });
    forwarder.listen(0, '127.0.0.1');
    await once(forwarder, 'listening');
    const forwardedAddress = forwarder.address();
    if (!forwardedAddress || typeof forwardedAddress === 'string')
      throw new Error('Missing forwarder');
    const webhookUrl = `http://127.0.0.1:${forwardedAddress.port}/events`;
    const received = async () => {
      const response = await fetch(`${receiver.url}/receipts`, {
        headers: {
          authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
        },
        signal: AbortSignal.timeout(1000),
      });
      expect(response.status).toBe(200);
      return z
        .array(
          z.object({
            notice: z
              .object({
                id: z.string(),
                sourceConfirmationId: z.string().regex(/^source-accepted:source_[a-f0-9-]{36}$/),
              })
              .passthrough(),
            receivedAt: z.string(),
          })
        )
        .parse(await response.json());
    };
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    cleanups.push(() => postgres.stop());
    const authorityPath = join(directory, 'authority.json');
    await writeFile(authorityPath, JSON.stringify(authorityFixture()), { mode: 0o600 });
    // The actual executable parses arguments in a cwd with no checkout-private dotenv file.
    const recoverConfirmation = async (id: string) => {
      const invocation = exec(
        process.execPath,
        [
          '--import',
          resolve('node_modules/tsx/dist/loader.mjs'),
          resolve('scripts/operator.ts'),
          'recover-source-confirmation',
          '--authority-file',
          authorityPath,
          '--id',
          id,
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            DATABASE_URL: postgres.getConnectionUri(),
          },
          timeout: 10000,
        }
      );
      const outcome = await invocation.then(
        ({ stdout }) => ({
          exitCode: 0,
          ...z
            .object({ recovered: z.boolean() })
            .parse(JSON.parse(stdout.trim().split('\n').at(-1) ?? '')),
        }),
        (error: unknown) => {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 1) throw error;
          return { exitCode: 1 };
        }
      );
      console.info('Receipt-based recover-source-confirmation CLI completed and reaped', {
        pid: invocation.child.pid,
        id,
        ...outcome,
      });
      return outcome;
    };
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
    const startSources = () => {
      const runtime = ManagedRuntime.make(
        sourcePostgresLayer({ databaseUrl: postgres.getConnectionUri(), ...delivery })
      );
      cleanups.push(() => runtime.dispose());
      return runtime;
    };
    let sources = startSources();
    const wallpaper = authority.applications.wallpaper;
    if (!wallpaper) throw new Error('Missing Wallpaper application');
    const applications = { wallpaper };
    const startNotifications = () => {
      const notifications = ManagedRuntime.make(
        operatorWebhookLayer({
          url,
          credential: authority.broker.service,
          applications,
          target: { url: webhookUrl, token: 'operator-inbox-token' },
          ...delivery,
        })
      );
      cleanups.push(() => notifications.dispose());
      return notifications;
    };
    let notifications = startNotifications();
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
    const sourceId = `source_${randomUUID()}`;
    const candidateId = `candidate_${randomUUID()}`;
    const confirmation: SourceConfirmation = {
      id: `source-accepted:${sourceId}`,
      applicationId: 'wallpaper',
      assetId: created.assetId,
      assetType: 'wallpaper',
      candidateId,
      sourceId,
      sourceSetRevision: '1',
      deliveryRevision: '1',
      defaultSourceId: sourceId,
      initialAnalysisSourceId: sourceId,
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
    let outbox = await sources.runPromise(SourceAcceptanceOutbox);
    const failures: SourcePublication[] = [];
    const completed: SourcePublication[] = [];
    const alerts: SourceConfirmationAlert[] = [];
    let holdAcknowledgements = true;
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
                  if (holdAcknowledgements) {
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
      notice: expect.objectContaining({
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        kind: 'source-confirmation-quarantine',
        subject: 'asset.results.wallpaper',
        reason: 'exhausted',
        context: confirmation.context,
        applicationId: 'wallpaper',
      }),
    });
    await expect
      .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
        timeout: 5000,
      })
      .toBe(1);
    expect(httpFailures).toBe(3);
    expect(await received()).toEqual([]);
    rejectHttp = false;
    await recoverQuarantine(operator, authority, 'wallpaper', 1);
    await expect.poll(received, { timeout: 5000 }).toEqual([receipt]);
    await expect.poll(() => alerts.length).toBeGreaterThanOrEqual(2);
    await publisher.dispose();
    const firstAlert = (await sources.runPromise(outbox.pendingAlerts()))[0];
    if (!firstAlert) throw new Error('Missing first Source quarantine');
    expect(alerts[1]).toEqual(alerts[0]);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(2);
    expect(failures.map((publication) => publication.attempts)).toEqual([1, 2, 3]);
    for (const publication of failures) expect(publication.confirmation).toEqual(confirmation);
    expect(new Set(failures.map((publication) => publication.occurredAt)).size).toBe(1);
    expect((await manager.streams.info('ASSET_RESULTS')).state.messages).toBe(0);
    const delivered = await received();
    await notifications.dispose();
    await sources.dispose();
    await receiver.stop();
    receiver = await startReceiver();
    sources = startSources();
    outbox = await sources.runPromise(SourceAcceptanceOutbox);
    expect(await sources.runPromise(outbox.pendingAlerts())).toEqual([firstAlert]);
    notifications = startNotifications();
    await notifications.runPromise(OperatorNotificationHealth);
    const persisted = await received();
    expect(persisted).toEqual(delivered);
    const firstReceipt = persisted[0];
    if (!firstReceipt) throw new Error('Missing first restarted authenticated receipt');
    const visibleReceipts = async () => {
      const response = await fetch(`${receiver.url}/`, {
        headers: {
          authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
        },
        signal: AbortSignal.timeout(1000),
      });
      expect(response.status).toBe(200);
      return response.text();
    };
    expect(await visibleReceipts()).toContain(firstReceipt.notice.sourceConfirmationId);
    expect(firstReceipt.notice.sourceConfirmationId).toBe(confirmation.id);
    expect(firstReceipt.notice.id).not.toBe(firstReceipt.notice.sourceConfirmationId);
    // Retry the same durable notice after both persistence and receiver restart.
    holdAcknowledgements = false;
    const restarted = startPublisher();
    await restarted.runPromise(SourceConfirmationHealth);
    await expect.poll(() => sources.runPromise(outbox.pendingAlerts())).toEqual([]);
    await restarted.dispose();
    expect(await received()).toEqual(persisted);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(2);
    expect(await recoverConfirmation(firstReceipt.notice.id)).toEqual({ exitCode: 1 });
    expect(await recoverConfirmation(firstReceipt.notice.sourceConfirmationId)).toEqual({
      exitCode: 0,
      recovered: true,
    });
    expect(await recoverConfirmation(firstReceipt.notice.sourceConfirmationId)).toEqual({
      exitCode: 0,
      recovered: false,
    });
    await sources.runPromise(outbox.alerted(firstAlert));
    expect(await sources.runPromise(outbox.pendingAlerts())).toEqual([]);
    holdAcknowledgements = true;
    const renewed = startPublisher();
    await renewed.runPromise(SourceConfirmationHealth);
    await expect.poll(received, { timeout: 5000 }).toEqual([receipt, receipt]);
    await renewed.dispose();
    const secondAlert = (await sources.runPromise(outbox.pendingAlerts()))[0];
    if (!secondAlert) throw new Error('Missing renewed Source quarantine');
    expect(secondAlert.id).toBe(firstAlert.id);
    expect(secondAlert.quarantineId).not.toBe(firstAlert.quarantineId);
    const beforeRestart = await received();
    await notifications.dispose();
    await receiver.stop();
    receiver = await startReceiver();
    notifications = startNotifications();
    await notifications.runPromise(OperatorNotificationHealth);
    const receipts = await received();
    expect(receipts).toEqual(beforeRestart);
    const secondReceipt = receipts[1];
    if (!secondReceipt) throw new Error('Missing renewed restarted authenticated receipt');
    expect(receipts[0]).toEqual(firstReceipt);
    expect(secondReceipt.notice.id).not.toBe(firstReceipt.notice.id);
    expect(secondReceipt.notice.sourceConfirmationId).toBe(
      firstReceipt.notice.sourceConfirmationId
    );
    const rendered = await visibleReceipts();
    for (const retained of receipts) {
      expect(rendered).toContain(retained.notice.id);
      expect(rendered).toContain(retained.notice.sourceConfirmationId);
    }
    const oldPublication = failures[0];
    if (!oldPublication) throw new Error('Missing first publication');
    await sources.runPromise(outbox.alerted(firstAlert));
    await sources.runPromise(outbox.published(oldPublication));
    await sources.runPromise(outbox.failed(oldPublication));
    expect(await sources.runPromise(outbox.pendingAlerts())).toEqual([secondAlert]);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(3);
    expect(failures.map((publication) => publication.attempts)).toEqual([1, 2, 3, 1, 2, 3]);
    await manager.streams.update('ASSET_RESULTS', originalConfig);
    expect(await sources.runPromise(outbox.claim(10))).toEqual([]);
    expect(await recoverConfirmation(secondReceipt.notice.sourceConfirmationId)).toEqual({
      exitCode: 0,
      recovered: true,
    });
    expect(await recoverConfirmation(secondReceipt.notice.sourceConfirmationId)).toEqual({
      exitCode: 0,
      recovered: false,
    });
    holdAcknowledgements = false;
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
        sourceId,
        candidateId,
        sourceSetRevision: '1',
        deliveryRevision: '1',
        defaultSourceId: sourceId,
        initialAnalysisSourceId: sourceId,
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
    expect(await recoverConfirmation(secondReceipt.notice.sourceConfirmationId)).toEqual({
      exitCode: 0,
      recovered: false,
    });
    expect((await manager.streams.info('ASSET_RESULTS')).state.messages).toBe(1);
    expect(await received()).toHaveLength(2);
    for (const publication of [...failures, ...completed]) {
      expect(publication.confirmation).toEqual(confirmation);
      expect(publication.id).toBe(confirmation.id);
      expect(publication.occurredAt).toBe(oldPublication.occurredAt);
    }
    console.info('Two Source quarantine cycles recovered from restarted authenticated receipts', {
      firstNoticeId: firstReceipt.notice.id,
      secondNoticeId: secondReceipt.notice.id,
      recoveryHandle: secondReceipt.notice.sourceConfirmationId,
      attempts: failures.map((publication) => publication.attempts),
      consumed: completed.length,
      controlledHttpRejections: httpFailures,
    });
  } catch (error) {
    cleanupFailures.push(error);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 1)
    throw new AggregateError(cleanupFailures, 'Source confirmation contract failed');
});
