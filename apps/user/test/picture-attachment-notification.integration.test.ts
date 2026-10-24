import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { AckPolicy, connect, StorageType } from 'nats';
import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { databaseLayer } from '../src/adapters/database/index.js';
import {
  attachmentBrokerLayer,
  attachmentPostgresLayer,
} from '../src/adapters/picture-attachments/index.js';
import {
  AttachmentDelivery,
  AttachmentFailure,
  AttachmentHealth,
  PictureAttachments,
  pictureAttachmentsLayer,
  type AttachmentPublication,
} from '../src/capabilities/picture-attachments/index.js';
import { runAttachmentOperator } from '../scripts/attachment-operator.js';

it('renews exhausted User notices through the supported inbox without changing the original command', async () => {
  const releases: (() => unknown | Promise<unknown>)[] = [];
  const errors: unknown[] = [];
  try {
    const database = await new PostgreSqlContainer('postgres:16-alpine').start();
    releases.push(() => database.stop());
    const databaseUrl = database.getConnectionUri();
    const pool = new Pool({ connectionString: databaseUrl });
    releases.push(() => pool.end());
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    await pool.query(
      "insert into profiles(id,display_name,handle) values ('owner','Owner','owner')"
    );
    const broker = await new GenericContainer('nats:2.10-alpine')
      .withCopyContentToContainer([
        {
          target: '/config.json',
          content: JSON.stringify({
            port: 4222,
            http: 8222,
            jetstream: { store_dir: '/data' },
            accounts: {
              ASSET_USER: {
                jetstream: 'enabled',
                users: [
                  { user: 'operator', password: 'operator-test' },
                  {
                    user: 'user-client',
                    password: 'application-test',
                    permissions: {
                      publish: {
                        allow: [
                          'asset.commands.user.create',
                          'asset.commands.user.delete',
                          '$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_user',
                          '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_user',
                          '$JS.ACK.>',
                        ],
                      },
                      subscribe: { allow: ['_ASSET_INBOX.user.>'] },
                    },
                  },
                ],
              },
            },
          }),
        },
      ])
      .withCommand(['-c', '/config.json'])
      .withExposedPorts(4222, 8222)
      .withWaitStrategy(Wait.forHttp('/healthz', 8222))
      .start();
    releases.push(() => broker.stop());
    const natsUrl = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
    const operator = await connect({ servers: natsUrl, user: 'operator', pass: 'operator-test' });
    releases.push(() => operator.close());
    const manager = await operator.jetstreamManager();
    for (const [name, subjects] of [
      ['ASSET_COMMANDS', ['asset.commands.user.create', 'asset.commands.user.delete']],
      ['ASSET_RESULTS', ['asset.results.user']],
    ] as const)
      await manager.streams.add({ name, subjects: [...subjects], storage: StorageType.File });
    await manager.consumers.add('ASSET_RESULTS', {
      durable_name: 'results_user',
      filter_subject: 'asset.results.user',
      ack_policy: AckPolicy.Explicit,
    });
    const directory = await mkdtemp(join(tmpdir(), 'user-quarantine-receipts-'));
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const { createOperatorInbox } = await import(
      new URL('../../../scripts/operator-inbox.mjs', import.meta.url).href
    );
    const closeInbox = async (server: Server) => {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    };
    const openInbox = async () => {
      const server: Server = await createOperatorInbox({ directory, token: 'test' });
      releases.push(() => closeInbox(server));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing inbox address');
      return { server, url: `http://127.0.0.1:${address.port}` };
    };
    let inbox = await openInbox();
    const receipts = async () => {
      const response = await fetch(`${inbox.url}/receipts`, {
        headers: { Authorization: `Basic ${Buffer.from('operator:test').toString('base64')}` },
      });
      expect(response.status).toBe(200);
      return z
        .array(
          z.object({
            notice: z.object({
              id: z.string(),
              applicationId: z.literal('user'),
              kind: z.literal('user-workflow-quarantine'),
              subject: z.literal('user.workflow.outbox'),
              reason: z.literal('exhausted'),
              recoveryId: z.string(),
              recoveryScope: z.literal('outbox'),
            }),
            receivedAt: z.string(),
          })
        )
        .parse(await response.json());
    };
    const services = () =>
      pictureAttachmentsLayer.pipe(
        Layer.provideMerge(
          attachmentPostgresLayer({ maxAttempts: 2, retryDelayMs: 0, leaseMs: 60000 }).pipe(
            Layer.provide(databaseLayer({ databaseUrl }))
          )
        )
      );
    let storage = ManagedRuntime.make(services());
    releases.push(() => storage.dispose());
    let delivery = await storage.runPromise(AttachmentDelivery);
    let attachments = await storage.runPromise(PictureAttachments);
    const failures: AttachmentPublication[] = [];
    const exhaust = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const [publication] = await storage.runPromise(delivery.claim());
        if (!publication) throw new Error('Expected pending publication');
        // Controlled public-port publication failure, not a broker or Asset service outage.
        await storage.runPromise(delivery.failed(publication));
        failures.push(publication);
      }
      expect(await storage.runPromise(delivery.claim())).toEqual([]);
    };
    const acknowledgements: Parameters<AttachmentDelivery['alerted']>[] = [];
    let holdAcknowledgements = true;
    let token = 'wrong';
    const start = () => {
      const current = delivery;
      return ManagedRuntime.make(
        attachmentBrokerLayer({
          natsUrl,
          credential: { user: 'user-client', password: 'application-test' },
          operatorNotification: { url: `${inbox.url}/events`, token },
          maxAttempts: 2,
          retryDelayMs: 1,
          pollMs: 10,
          shutdownTimeoutMs: 3000,
        }).pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(PictureAttachments, attachments),
              Layer.succeed(AttachmentDelivery, {
                ...current,
                alerted: (...args) =>
                  Effect.suspend(() => {
                    acknowledgements.push(args);
                    // HTTP acceptance is real; only the following local persistence failure is controlled.
                    return holdAcknowledgements
                      ? Effect.fail(
                          new AttachmentFailure({
                            operation: 'test-alert-acknowledgement',
                            cause: 'injected',
                          })
                        )
                      : current.alerted(...args);
                  }),
              })
            )
          )
        )
      );
    };
    let worker: ReturnType<typeof start> | undefined;
    releases.push(() => worker?.dispose());
    const outcome = await storage.runPromise(
      attachments.begin({ profileId: 'owner' }, 'renewed', 1)
    );
    if (outcome.kind !== 'attachment') throw new Error(outcome.kind);
    const intent = outcome.attachment;
    await exhaust();
    const firstAlerts = await storage.runPromise(delivery.alerts());
    expect(firstAlerts).toHaveLength(1);
    worker = start();
    const health = await worker.runPromise(AttachmentHealth);
    await expect.poll(() => worker?.runPromise(health.check())).toBe(false);
    await worker.dispose();
    expect(await receipts()).toEqual([]);
    expect(await storage.runPromise(delivery.alerts())).toEqual(firstAlerts);
    token = 'test';
    worker = start();
    await worker.runPromise(AttachmentHealth);
    await expect.poll(() => acknowledgements.length).toBeGreaterThanOrEqual(2);
    await worker.dispose();
    const firstReceipts = await receipts();
    expect(firstReceipts).toHaveLength(1);
    expect(firstReceipts[0]?.notice.recoveryId).toBe(intent.creationEventId);
    expect(acknowledgements[1]).toEqual(acknowledgements[0]);
    expect(await storage.runPromise(delivery.alerts())).toEqual(firstAlerts);
    holdAcknowledgements = false;
    worker = start();
    await worker.runPromise(AttachmentHealth);
    await expect.poll(() => storage.runPromise(delivery.alerts())).toEqual([]);
    await worker.dispose();
    expect(await receipts()).toEqual(firstReceipts);
    expect(
      await runAttachmentOperator(['recover-outbox', intent.creationEventId], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    expect(await storage.runPromise(delivery.recover(intent.creationEventId))).toBe(false);
    await storage.dispose();
    storage = ManagedRuntime.make(services());
    delivery = await storage.runPromise(AttachmentDelivery);
    attachments = await storage.runPromise(PictureAttachments);
    await exhaust();
    holdAcknowledgements = true;
    worker = start();
    await worker.runPromise(AttachmentHealth);
    await expect.poll(receipts, { timeout: 5000 }).toHaveLength(2);
    await worker.dispose();
    const pending = await storage.runPromise(delivery.alerts());
    expect(pending).toHaveLength(1);
    expect(pending).not.toEqual(firstAlerts);
    const twoReceipts = await receipts();
    expect(twoReceipts[0]).toEqual(firstReceipts[0]);
    expect(twoReceipts[1]?.notice.id).not.toBe(firstReceipts[0]?.notice.id);
    expect(failures.map((p) => p.attempts)).toEqual([0, 1, 0, 1]);
    for (const publication of failures) {
      expect(publication.id).toBe(intent.creationEventId);
      expect(publication.event).toEqual(failures[0]?.event);
    }
    await closeInbox(inbox.server);
    inbox = await openInbox();
    await storage.dispose();
    storage = ManagedRuntime.make(services());
    delivery = await storage.runPromise(AttachmentDelivery);
    attachments = await storage.runPromise(PictureAttachments);
    expect(await receipts()).toEqual(twoReceipts);
    expect(await storage.runPromise(delivery.alerts())).toEqual(pending);
    const stale = acknowledgements[0];
    if (!stale) throw new Error('Missing original acknowledgement');
    await storage.runPromise(delivery.alerted(...stale));
    expect(await storage.runPromise(delivery.alerts())).toEqual(pending);
    expect(
      await storage.runPromise(attachments.get({ profileId: 'owner' }, intent.id))
    ).toMatchObject({
      attachment: { attentionRequired: true, state: 'creating-asset' },
    });
    holdAcknowledgements = false;
    worker = start();
    await worker.runPromise(AttachmentHealth);
    await expect.poll(() => storage.runPromise(delivery.alerts())).toEqual([]);
    await worker.dispose();
    expect(await receipts()).toEqual(twoReceipts);
    expect(
      await runAttachmentOperator(['recover-outbox', intent.creationEventId], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    worker = start();
    await worker.runPromise(AttachmentHealth);
    await expect
      .poll(async () => (await manager.streams.info('ASSET_COMMANDS')).state.messages)
      .toBe(1);
    await expect
      .poll(() => storage.runPromise(attachments.get({ profileId: 'owner' }, intent.id)))
      .toMatchObject({
        attachment: { attentionRequired: false, state: 'creating-asset' },
      });
    await worker.dispose();
    const stored = await manager.streams.getMessage('ASSET_COMMANDS', { seq: 1 });
    expect(JSON.parse(stored.string())).toEqual(failures[0]?.event);
    expect(await storage.runPromise(delivery.claim())).toEqual([]);
    expect(await receipts()).toEqual(twoReceipts);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'User notification contract or cleanup failed');
});
