import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { workflowPostgresLayer } from '../src/adapters/workflow/index.js';
import { once } from 'node:events';
import { core } from '@opentelemetry/sdk-node';
import { propagation } from '@opentelemetry/api';
import { GenericContainer, Wait } from 'testcontainers';
import { AckPolicy, connect, RetentionPolicy, DiscardPolicy, StorageType } from 'nats';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  Creation,
  creationLayer,
  WorkflowStore,
  WorkflowDelivery,
  WorkflowHealth,
  WorkflowFailure,
  type WorkflowDeliveryPort,
  type WorkflowPublication,
} from '../src/capabilities/creation/index.js';
import { assetWorkflowLayer, recoverConfirmation } from '../src/adapters/asset-workflow/index.js';
type Release = () => unknown | Promise<unknown>;
type Defer = (release: Release) => void;
async function withResources(run: (defer: Defer) => Promise<void>) {
  const releases: Release[] = [];
  const errors: unknown[] = [];
  try {
    await run((release) => releases.push(release));
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
  if (errors.length) throw new AggregateError(errors, 'Wallpaper workflow test or cleanup failed');
}
async function closeInbox(inbox: ReturnType<typeof createServer>) {
  if (!inbox.listening) return;
  try {
    inbox.closeAllConnections();
  } finally {
    await new Promise<void>((resolve, reject) =>
      inbox.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
async function startBroker(defer: Defer) {
  const configuration = {
    port: 4222,
    http: 8222,
    jetstream: { store_dir: '/data' },
    no_auth_user: 'legacy',
    accounts: {
      LEGACY: { jetstream: 'enabled', users: [{ user: 'legacy', password: '' }] },
      ASSET_WALLPAPER: {
        jetstream: 'enabled',
        users: [
          { user: 'operator', password: 'operator-test' },
          {
            user: 'wallpaper-client',
            password: 'application-test',
            permissions: {
              publish: {
                allow: [
                  'asset.commands.wallpaper.create',
                  '$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_wallpaper',
                  '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_wallpaper',
                  '$JS.ACK.>',
                ],
              },
              subscribe: { allow: ['_ASSET_INBOX.wallpaper.>'] },
            },
          },
        ],
      },
    },
  };
  const container = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: JSON.stringify(configuration), target: '/config.json' },
    ])
    .withCommand(['-c', '/config.json'])
    .withExposedPorts(4222, 8222)
    .withWaitStrategy(Wait.forHttp('/healthz', 8222))
    .start();
  defer(() => container.stop());
  const url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
  const operator = await connect({ servers: url, user: 'operator', pass: 'operator-test' });
  defer(() => operator.close());
  const legacy = await connect({ servers: url });
  defer(() => legacy.close());
  return { container, url, operator, legacy };
}
async function setupStreams(
  operator: Awaited<ReturnType<typeof connect>>,
  legacy: Awaited<ReturnType<typeof connect>>
) {
  const manager = await operator.jetstreamManager();
  const publicManager = await legacy.jetstreamManager();
  for (const [name, subjects] of [
    ['ASSET_COMMANDS', ['asset.commands.wallpaper.create']],
    ['ASSET_RESULTS', ['asset.results.wallpaper']],
  ] as const)
    await manager.streams.add({
      name,
      subjects: [...subjects],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.New,
    });
  await manager.consumers.add('ASSET_RESULTS', {
    durable_name: 'results_wallpaper',
    filter_subject: 'asset.results.wallpaper',
    ack_policy: AckPolicy.Explicit,
    max_ack_pending: 4,
  });
  await publicManager.streams.add({
    name: 'WALLPAPER',
    subjects: ['wallpaper.>'],
    storage: StorageType.File,
  });
  return { manager, publicManager };
}
it('uses protected application credentials, persists publication acknowledgements and resumes its durable result consumer', () =>
  withResources(async (defer) => {
    propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());
    defer(() => propagation.disable());
    const { url, operator, legacy } = await startBroker(defer);
    const calls: unknown[] = [];
    const publicationTraces: string[] = [];
    const confirmationTraces: string[] = [];
    const completed: string[] = [];
    const notices: unknown[] = [];
    let alerted = false;
    const inbox = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer test') {
        response.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      notices.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200).end();
    });
    defer(() => closeInbox(inbox));
    inbox.listen(0, '127.0.0.1');
    await once(inbox, 'listening');
    const inboxAddress = inbox.address();
    if (!inboxAddress || typeof inboxAddress === 'string') throw new Error('Missing inbox address');
    let runtime: ManagedRuntime.ManagedRuntime<WorkflowHealth | Creation, unknown> | undefined;
    defer(() => runtime?.dispose());
    const event = {
      specversion: '1.0',
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      id: 'creation-event',
      source: 'https://wallpaperdb/wallpaper',
      type: 'asset.command.create',
      time: '2026-10-22T00:00:00.000Z',
      datacontenttype: 'application/json',
      data: {
        commandId: 'command-1',
        applicationReference: 'wallpaper-1',
        assetType: 'wallpaper',
        ownerSubject: 'creator',
      },
    };
    const records: WorkflowPublication[] = [
      {
        id: 'creation-event',
        wallpaperId: 'wallpaper-1',
        destination: 'asset-create',
        event,
        leaseId: 'lease-create',
        attempts: 0,
      },
      {
        id: 'publication-event',
        wallpaperId: 'wallpaper-1',
        destination: 'publication',
        event: {
          ...event,
          id: 'publication-event',
          type: 'wallpaper.published',
          data: {
            wallpaperId: 'wallpaper-1',
            assetId: 'asset-1',
            firstSourceId: 'source-1',
            initialAnalysisSourceId: 'source-1',
            contributorId: 'creator',
          },
        },
        leaseId: 'lease-publication',
        attempts: 0,
      },
    ];
    let claimed = false;
    const delivery = Layer.succeed(WorkflowDelivery, {
      claim: () =>
        Effect.sync(() => {
          if (claimed) return [];
          claimed = true;
          return records;
        }),
      complete: (p) =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          publicationTraces.push(span.traceId);
          completed.push(p.id);
        }).pipe(Effect.orDie),
      failed: () => Effect.die('Unexpected publication failure'),
      quarantine: () => Effect.die('Unexpected quarantine'),
      recover: () => Effect.succeed(false),
      alerts: () =>
        Effect.succeed(
          alerted
            ? []
            : [
                {
                  id: 'retained-record',
                  scope: 'outbox',
                  reason: 'exhausted',
                  quarantineId: 'retained-quarantine',
                },
              ]
        ),
      alerted: () =>
        Effect.sync(() => {
          alerted = true;
        }),
      retainedConfirmation: () => Effect.succeed(null),
      confirmationRecovered: () => Effect.void,
    });
    const creation = Layer.succeed(Creation, {
      list: () => Effect.succeed([]),
      begin: () => Effect.succeed({ kind: 'unavailable' }),
      get: () => Effect.succeed({ kind: 'unavailable' }),
      expectSource: () => Effect.succeed({ kind: 'unavailable' }),
      assetResult: (result) =>
        Effect.sync(() => {
          calls.push(result);
          return 'applied' as const;
        }).pipe(
          Effect.tap(() =>
            Effect.currentSpan.pipe(
              Effect.tap((span) => Effect.sync(() => confirmationTraces.push(span.traceId))),
              Effect.orDie
            )
          )
        ),
      sourceAccepted: (confirmation) =>
        Effect.sync(() => {
          calls.push(confirmation);
          return 'applied' as const;
        }).pipe(
          Effect.tap(() =>
            Effect.currentSpan.pipe(
              Effect.tap((span) => Effect.sync(() => confirmationTraces.push(span.traceId))),
              Effect.orDie
            )
          )
        ),
    });
    const options = {
      natsUrl: url,
      ownerNamespace: 'authors',
      credential: { user: 'wallpaper-client', password: 'application-test' },
      identityProviders: [],
      operatorNotification: { url: `http://127.0.0.1:${inboxAddress.port}/events`, token: 'test' },
      maxAttempts: 3,
      retryDelayMs: 10,
      pollMs: 10,
      shutdownTimeoutMs: 3000,
    };
    const { manager, publicManager } = await setupStreams(operator, legacy);
    const start = () =>
      ManagedRuntime.make(
        assetWorkflowLayer(options).pipe(Layer.provideMerge(creation), Layer.provide(delivery))
      );
    runtime = start();
    expect(await runtime.runPromise(WorkflowHealth.use((h) => h.check()))).toBe(true);
    await expect.poll(() => completed).toEqual(['creation-event', 'publication-event']);
    await expect.poll(() => notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      applicationId: 'wallpaper',
      kind: 'wallpaper-workflow-quarantine',
      recoveryId: 'retained-record',
      recoveryScope: 'outbox',
      reason: 'exhausted',
    });
    expect(alerted).toBe(true);
    expect(
      JSON.parse((await manager.streams.getMessage('ASSET_COMMANDS', { seq: 1 })).string())
    ).toEqual(event);
    expect((await publicManager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const result = {
      ...event,
      id: 'result-event',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      causationid: 'creation-event',
      causationsource: 'https://wallpaperdb/wallpaper',
      data: {
        commandId: 'command-1',
        applicationReference: 'wallpaper-1',
        outcome: 'created',
        assetId: 'asset-1',
      },
    };
    await operator.jetstream().publish('asset.results.wallpaper', JSON.stringify(result));
    await expect.poll(() => calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      wallpaperId: 'wallpaper-1',
      commandId: 'command-1',
      creationEventId: 'creation-event',
      outcome: 'created',
      assetId: 'asset-1',
    });
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('ASSET_RESULTS', 'results_wallpaper')).num_ack_pending
      )
      .toBe(0);
    await runtime.dispose();
    runtime = start();
    await runtime.runPromise(WorkflowHealth);
    const source = {
      ...result,
      id: 'source-event',
      type: 'asset.source.accepted',
      causationsource: 'https://wallpaperdb/asset/authors',
      correlationid: 'intent-1',
      data: {
        assetId: 'asset-1',
        assetType: 'wallpaper',
        candidateId: 'candidate-1',
        sourceId: 'source-1',
        defaultSourceId: 'source-1',
        initialAnalysisSourceId: 'source-1',
        sourceSetRevision: '1',
        deliveryRevision: '1',
      },
    };
    await operator.jetstream().publish('asset.results.wallpaper', JSON.stringify(source));
    await expect.poll(() => calls).toHaveLength(2);
    expect(publicationTraces).toEqual([
      '11111111111111111111111111111111',
      '11111111111111111111111111111111',
    ]);
    expect(confirmationTraces).toEqual([
      '11111111111111111111111111111111',
      '11111111111111111111111111111111',
    ]);
    expect(calls[1]).toMatchObject({
      assetId: 'asset-1',
      candidateId: 'candidate-1',
      intentId: 'intent-1',
      occurrenceId: 'source-event',
    });
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('ASSET_RESULTS', 'results_wallpaper')).num_ack_pending
      )
      .toBe(0);
  }));

it('renews exhausted publication notices through the durable deduplicating inbox and completes the original event', () =>
  withResources(async (defer) => {
    const { url, operator, legacy } = await startBroker(defer);
    const postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    defer(() => postgres.stop());
    const databaseUrl = `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`;
    const pool = new Pool({ connectionString: databaseUrl });
    defer(() => pool.end());
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const directory = await mkdtemp(join(tmpdir(), 'wallpaper-quarantine-receipts-'));
    defer(() => rm(directory, { recursive: true, force: true }));
    const { createOperatorInbox } = await import(
      new URL('../../../scripts/operator-inbox.mjs', import.meta.url).href
    );
    const openInbox = async () => {
      const inbox: Server = await createOperatorInbox({ directory, token: 'test' });
      defer(() => closeInbox(inbox));
      inbox.listen(0, '127.0.0.1');
      await once(inbox, 'listening');
      const address = inbox.address();
      if (!address || typeof address === 'string') throw new Error('Missing operator inbox');
      return { inbox, address: `http://127.0.0.1:${address.port}` };
    };
    let inbox = await openInbox();
    const receipts = async () => {
      const response = await fetch(`${inbox.address}/receipts`, {
        headers: { Authorization: `Basic ${Buffer.from('operator:test').toString('base64')}` },
      });
      expect(response.status).toBe(200);
      return z
        .array(
          z.object({
            notice: z.object({
              id: z.string(),
              applicationId: z.literal('wallpaper'),
              kind: z.literal('wallpaper-workflow-quarantine'),
              subject: z.string(),
              reason: z.enum(['exhausted', 'invalid']),
              recoveryId: z.string(),
              recoveryScope: z.string(),
            }),
            receivedAt: z.string(),
          })
        )
        .parse(await response.json());
    };
    const services = () =>
      creationLayer('authors').pipe(
        Layer.provideMerge(
          workflowPostgresLayer({
            databaseUrl,
            maxAttempts: 3,
            retryDelayMs: 0,
            leaseMs: 60_000,
          })
        )
      );
    let storage = ManagedRuntime.make(services());
    defer(() => storage.dispose());
    let delivery = await storage.runPromise(WorkflowDelivery);
    let creation = await storage.runPromise(Creation);
    const failures: WorkflowPublication[] = [];
    const completions: WorkflowPublication[] = [];
    const acknowledgements: Parameters<WorkflowDeliveryPort['alerted']>[] = [];
    let failAcknowledgement = true;
    let holdAcknowledgements = false;
    const start = () => {
      const current = delivery;
      return ManagedRuntime.make(
        assetWorkflowLayer({
          natsUrl: url,
          ownerNamespace: 'authors',
          credential: { user: 'wallpaper-client', password: 'application-test' },
          identityProviders: [],
          operatorNotification: { url: `${inbox.address}/events`, token: 'test' },
          maxAttempts: 3,
          retryDelayMs: 0,
          pollMs: 10,
          shutdownTimeoutMs: 3000,
        }).pipe(
          Layer.provideMerge(
            Layer.merge(
              Layer.succeed(Creation, creation),
              Layer.succeed(WorkflowDelivery, {
                ...current,
                failed: (p) =>
                  current.failed(p).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        failures.push(p);
                      })
                    )
                  ),
                complete: (p) =>
                  current.complete(p).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        completions.push(p);
                      })
                    )
                  ),
                alerted: (...args) =>
                  Effect.suspend(() => {
                    acknowledgements.push(args);
                    // The real HTTP receiver accepted the notice. Only the local acknowledgement failure is injected.
                    if (failAcknowledgement || holdAcknowledgements) {
                      failAcknowledgement = false;
                      return Effect.fail(
                        new WorkflowFailure({
                          operation: 'test-alert-acknowledgement',
                          cause: 'injected',
                        })
                      );
                    }
                    return current.alerted(...args);
                  }),
              })
            )
          )
        )
      );
    };
    let worker: ReturnType<typeof start> | undefined;
    defer(() => worker?.dispose());
    const { manager, publicManager } = await setupStreams(operator, legacy);
    const originalConfig = (await publicManager.streams.info('WALLPAPER')).config;
    await publicManager.streams.update('WALLPAPER', { max_msg_size: 128 });
    const owner = { namespace: 'authors', subject: 'renewed-publication-owner' };
    const wallpaper = await storage.runPromise(WorkflowStore.use((s) => s.begin(owner, 'renewed')));
    worker = start();
    await worker.runPromise(WorkflowHealth);
    await expect.poll(() => completions.map((p) => p.id)).toEqual([wallpaper.creationEventId]);
    expect((await manager.streams.info('ASSET_COMMANDS')).state.messages).toBe(1);
    const command = completions[0];
    if (!command) throw new Error('Expected creation command');
    expect(
      JSON.parse((await manager.streams.getMessage('ASSET_COMMANDS', { seq: 1 })).string())
    ).toEqual(command.event);
    const result = {
      specversion: '1.0',
      id: 'renewed-result',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      time: wallpaper.createdAt,
      datacontenttype: 'application/json',
      causationsource: 'https://wallpaperdb/wallpaper',
      causationid: wallpaper.creationEventId,
      correlationid: wallpaper.id,
      data: {
        commandId: wallpaper.commandId,
        applicationReference: wallpaper.id,
        outcome: 'created',
        assetId: 'renewed-asset',
      },
    };
    await operator.jetstream().publish('asset.results.wallpaper', JSON.stringify(result));
    await expect
      .poll(() => storage.runPromise(creation.list(owner)))
      .toEqual([expect.objectContaining({ state: 'awaiting-source', assetId: 'renewed-asset' })]);
    await storage.runPromise(
      creation.expectSource(owner, wallpaper.id, {
        candidateId: 'renewed-candidate',
        intentId: 'renewed-intent',
      })
    );
    await operator.jetstream().publish(
      'asset.results.wallpaper',
      JSON.stringify({
        ...result,
        id: 'renewed-source',
        type: 'asset.source.accepted',
        causationsource: 'https://wallpaperdb/asset/authors',
        causationid: 'accept-renewed',
        correlationid: 'renewed-intent',
        data: {
          assetId: 'renewed-asset',
          assetType: 'wallpaper',
          candidateId: 'renewed-candidate',
          sourceId: 'renewed-source',
          defaultSourceId: 'renewed-source',
          initialAnalysisSourceId: 'renewed-source',
          sourceSetRevision: '1',
          deliveryRevision: '1',
        },
      })
    );
    const receipt = expect.objectContaining({
      notice: expect.objectContaining({
        applicationId: 'wallpaper',
        kind: 'wallpaper-workflow-quarantine',
        reason: 'exhausted',
        recoveryScope: 'outbox',
      }),
    });
    await expect.poll(receipts, { timeout: 5000 }).toEqual([receipt]);
    await expect.poll(() => storage.runPromise(delivery.alerts())).toEqual([]);
    await worker.dispose();
    expect(acknowledgements.length).toBeGreaterThanOrEqual(2);
    expect(acknowledgements[1]).toEqual(acknowledgements[0]);
    expect(failures.map((p) => p.attempts)).toEqual([0, 1, 2]);
    expect((await publicManager.streams.info('WALLPAPER')).state.messages).toBe(0);
    const original = failures[0];
    if (!original) throw new Error('Expected failed publication');
    const firstReceipt = (await receipts())[0];
    expect(firstReceipt?.notice.recoveryId).toBe(original.id);
    expect(
      await storage.runPromise(WorkflowStore.use((s) => s.begin(owner, 'renewed')))
    ).toMatchObject({ attentionRequired: true });
    holdAcknowledgements = true;
    expect(await storage.runPromise(delivery.recover(original.id))).toBe(true);
    worker = start();
    await worker.runPromise(WorkflowHealth);
    await expect.poll(receipts, { timeout: 5000 }).toEqual([receipt, receipt]);
    await worker.dispose();
    const pending = await storage.runPromise(delivery.alerts());
    expect(pending).toHaveLength(1);
    expect(pending[0]).not.toEqual(acknowledgements[0]?.[0]);
    const twoReceipts = await receipts();
    expect(twoReceipts[0]).toEqual(firstReceipt);
    expect(twoReceipts[1]?.notice.id).not.toBe(firstReceipt?.notice.id);
    expect(failures.map((p) => p.attempts)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(
      failures.every(
        (p) => p.id === original.id && JSON.stringify(p.event) === JSON.stringify(original.event)
      )
    ).toBe(true);
    await closeInbox(inbox.inbox);
    inbox = await openInbox();
    expect(await receipts()).toEqual(twoReceipts);
    await storage.dispose();
    storage = ManagedRuntime.make(services());
    delivery = await storage.runPromise(WorkflowDelivery);
    creation = await storage.runPromise(Creation);
    expect(await storage.runPromise(delivery.alerts())).toEqual(pending);
    const [stale] = acknowledgements;
    if (!stale) throw new Error('Expected first occurrence acknowledgement');
    await storage.runPromise(delivery.alerted(...stale));
    expect(await storage.runPromise(delivery.alerts())).toEqual(pending);
    holdAcknowledgements = false;
    worker = start();
    await worker.runPromise(WorkflowHealth);
    await expect.poll(() => storage.runPromise(delivery.alerts())).toEqual([]);
    await worker.dispose();
    expect(acknowledgements.at(-1)).toEqual([pending[0]]);
    expect(await receipts()).toEqual(twoReceipts);
    expect(await storage.runPromise(delivery.claim())).toEqual([]);
    await publicManager.streams.update('WALLPAPER', originalConfig);
    expect(await storage.runPromise(delivery.recover(original.id))).toBe(true);
    worker = start();
    await worker.runPromise(WorkflowHealth);
    await expect
      .poll(() => completions.map((p) => p.id))
      .toEqual([wallpaper.creationEventId, original.id]);
    expect(
      JSON.parse((await publicManager.streams.getMessage('WALLPAPER', { seq: 1 })).string())
    ).toEqual(original.event);
    expect((await publicManager.streams.info('WALLPAPER')).state.messages).toBe(1);
    expect(await storage.runPromise(creation.list(owner))).toEqual([
      expect.objectContaining({
        id: wallpaper.id,
        assetId: 'renewed-asset',
        state: 'published',
        sourceId: 'renewed-source',
        attentionRequired: false,
      }),
    ]);
    expect(await storage.runPromise(delivery.recover(original.id))).toBe(false);
    expect(await receipts()).toEqual(twoReceipts);
    const invalid = 'not-json';
    const invalidIdentity = createHash('sha256').update(invalid).digest('hex');
    const invalidRecovery = createHash('sha256').update(invalidIdentity).digest('hex');
    await operator.jetstream().publish('asset.results.wallpaper', invalid);
    const notice = (id: string, reason: 'invalid' | 'exhausted') =>
      expect.objectContaining({
        notice: {
          id: createHash('sha256').update(`wallpaper:confirmation:${id}`).digest('hex'),
          applicationId: 'wallpaper',
          kind: 'wallpaper-workflow-quarantine',
          subject: 'asset.results.wallpaper',
          reason,
          recoveryId: id,
          recoveryScope: 'confirmation',
        },
      });
    await expect.poll(receipts).toEqual([...twoReceipts, notice(invalidRecovery, 'invalid')]);
    // A retained exhausted-confirmation fixture checks the unchanged receipt contract.
    await storage.runPromise(
      delivery.quarantine(
        'compatibility-exhausted',
        JSON.stringify(result),
        'confirmation-exhausted'
      )
    );
    const exhaustedRecovery = createHash('sha256').update('compatibility-exhausted').digest('hex');
    await expect
      .poll(receipts)
      .toEqual([
        ...twoReceipts,
        notice(invalidRecovery, 'invalid'),
        notice(exhaustedRecovery, 'exhausted'),
      ]);
    await expect.poll(() => storage.runPromise(delivery.alerts())).toEqual([]);
  }));

it('keeps recovered confirmations closed on protected redelivery and routes abandoned-lease recovery through the real outbox', () =>
  withResources(async (defer) => {
    const { url, operator, legacy } = await startBroker(defer);
    const postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    defer(() => postgres.stop());
    const databaseUrl = `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`;
    const pool = new Pool({ connectionString: databaseUrl });
    defer(() => pool.end());
    const notices: { recoveryId: string; recoveryScope: string }[] = [];
    const inbox = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer test') {
        response.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      notices.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200).end();
    });
    defer(() => closeInbox(inbox));
    inbox.listen(0, '127.0.0.1');
    await once(inbox, 'listening');
    const address = inbox.address();
    if (!address || typeof address === 'string') throw new Error('Missing inbox');
    const persistence = workflowPostgresLayer({
      databaseUrl,
      maxAttempts: 1,
      retryDelayMs: 0,
      leaseMs: 60_000,
    });
    const services = creationLayer('authors').pipe(Layer.provideMerge(persistence));
    const storage = ManagedRuntime.make(services);
    defer(() => storage.dispose());
    const start = () =>
      ManagedRuntime.make(
        assetWorkflowLayer({
          natsUrl: url,
          ownerNamespace: 'authors',
          credential: { user: 'wallpaper-client', password: 'application-test' },
          identityProviders: [],
          operatorNotification: { url: `http://127.0.0.1:${address.port}/events`, token: 'test' },
          maxAttempts: 1,
          retryDelayMs: 10,
          pollMs: 10,
          shutdownTimeoutMs: 3000,
        }).pipe(Layer.provideMerge(services))
      );
    let worker: ReturnType<typeof start> | undefined;
    defer(() => worker?.dispose());
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const { manager } = await setupStreams(operator, legacy);
    const nextClaim = async () => {
      let publications: readonly WorkflowPublication[] = [];
      await expect
        .poll(
          async () => {
            publications = await storage.runPromise(WorkflowDelivery.use((s) => s.claim()));
            return publications.length;
          },
          { timeout: 1000 }
        )
        .toBe(1);
      const [publication] = publications;
      if (!publication) throw new Error('Missing publication');
      return publication;
    };
    const owner = { namespace: 'authors', subject: 'broker-recovery' };
    const completed = await storage.runPromise(
      WorkflowStore.use((s) => s.begin(owner, 'completed'))
    );
    const command = await nextClaim();
    await storage.runPromise(WorkflowDelivery.use((s) => s.complete(command)));
    await storage.runPromise(
      Creation.use((c) =>
        c.assetResult({
          wallpaperId: completed.id,
          commandId: completed.commandId,
          creationEventId: completed.creationEventId,
          outcome: 'created',
          assetId: 'retained-asset',
        })
      )
    );
    const payload = JSON.stringify({
      specversion: '1.0',
      id: 'completed-result',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      time: completed.createdAt,
      datacontenttype: 'application/json',
      causationsource: 'https://wallpaperdb/wallpaper',
      causationid: completed.creationEventId,
      correlationid: completed.id,
      data: {
        commandId: completed.commandId,
        applicationReference: completed.id,
        outcome: 'created',
        assetId: 'retained-asset',
      },
    });
    const identity = createHash('sha256').update(payload).digest('hex');
    const recoveryId = createHash('sha256').update(identity).digest('hex');
    await storage.runPromise(
      WorkflowDelivery.use((s) =>
        s.quarantine(identity, payload, 'confirmation-exhausted', {
          kind: 'wallpaper',
          id: completed.id,
        })
      )
    );
    expect(await storage.runPromise(recoverConfirmation(recoveryId))).toBe(true);
    const abandoned = await storage.runPromise(
      WorkflowStore.use((s) =>
        s.begin(owner, 'abandoned', {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        })
      )
    );
    const lost = await nextClaim();
    await pool.query('UPDATE wallpaper_workflow_outbox SET available_at=$1 WHERE id=$2', [
      new Date(0),
      lost.id,
    ]);
    await storage.dispose();
    await operator.jetstream().publish('asset.results.wallpaper', payload);
    const consumer = await operator.jetstream().consumers.get('ASSET_RESULTS', 'results_wallpaper');
    const first = await consumer.next({ expires: 1000 });
    if (!first) throw new Error('Missing delivery');
    first.nak();
    await operator.flush();
    worker = start();
    await worker.runPromise(WorkflowHealth);
    await expect
      .poll(async () => {
        const info = await manager.consumers.info('ASSET_RESULTS', 'results_wallpaper');
        return info.num_pending + info.num_ack_pending;
      })
      .toBe(0);
    expect(await worker.runPromise(Creation.use((c) => c.list(owner)))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: completed.id,
          attentionRequired: false,
          assetId: 'retained-asset',
        }),
      ])
    );
    await expect
      .poll(() => notices)
      .toEqual([
        expect.objectContaining({
          recoveryId: abandoned.creationEventId,
          recoveryScope: 'outbox',
          reason: 'exhausted',
          applicationId: 'wallpaper',
        }),
      ]);
    expect(
      await worker.runPromise(WorkflowDelivery.use((s) => s.retainedConfirmation(recoveryId)))
    ).toBeNull();
    expect(await worker.runPromise(WorkflowDelivery.use((s) => s.recover(lost.id)))).toBe(true);
    await expect
      .poll(
        async () =>
          (await pool.query('SELECT status FROM wallpaper_workflow_outbox WHERE id=$1', [lost.id]))
            .rows[0]?.status
      )
      .toBe('published');
    expect(await worker.runPromise(Creation.use((c) => c.list(owner)))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: abandoned.id, attentionRequired: false }),
      ])
    );
    expect(
      JSON.parse((await manager.streams.getMessage('ASSET_COMMANDS', { seq: 1 })).string())
    ).toEqual(lost.event);
    expect((await manager.streams.info('ASSET_COMMANDS')).state.messages).toBe(1);
  }));
