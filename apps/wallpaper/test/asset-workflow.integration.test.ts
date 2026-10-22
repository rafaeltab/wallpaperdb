import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GenericContainer, Wait } from 'testcontainers';
import { AckPolicy, connect, RetentionPolicy, DiscardPolicy, StorageType } from 'nats';
import { expect, it } from 'vitest';
import {
  Creation,
  WorkflowDelivery,
  WorkflowHealth,
  type WorkflowPublication,
} from '../src/capabilities/creation/index.js';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
it('uses protected application credentials, persists publication acknowledgements and resumes its durable result consumer', async () => {
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
  const url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
  const operator = await connect({ servers: url, user: 'operator', pass: 'operator-test' });
  const legacy = await connect({ servers: url });
  const calls: unknown[] = [];
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
  inbox.listen(0, '127.0.0.1');
  await once(inbox, 'listening');
  const inboxAddress = inbox.address();
  if (!inboxAddress || typeof inboxAddress === 'string') throw new Error('Missing inbox address');
  let runtime: ManagedRuntime.ManagedRuntime<WorkflowHealth | Creation, unknown> | undefined;
  const event = {
    specversion: '1.0',
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
      Effect.sync(() => {
        completed.push(p.id);
      }),
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
        return 'applied';
      }),
    sourceAccepted: (confirmation) =>
      Effect.sync(() => {
        calls.push(confirmation);
        return 'applied';
      }),
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
  try {
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
  } finally {
    await runtime?.dispose();
    await operator.close();
    await legacy.close();
    inbox.closeAllConnections();
    await new Promise<void>((resolve) => inbox.close(() => resolve()));
    await container.stop();
  }
});
