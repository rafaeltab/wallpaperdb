import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
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
import {
  Creation,
  creationLayer,
  WorkflowStore,
  WorkflowDelivery,
  WorkflowHealth,
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
          alerted ? [] : [{ id: 'retained-record', scope: 'outbox', reason: 'exhausted' }]
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
