import { DiscardPolicy } from 'nats';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer, natsOutboxLayer, OutboxHealth } from '../src/adapters/events/index.js';
import { CatalogOutbox, CatalogFailure, type AvailableNotification } from '../src/catalog/index.js';
const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((n) => n.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
it('publishes a stable CloudEvent and retries ambiguous outbox completion without another occurrence', async () => {
  const pending: AvailableNotification[] = [
    {
      id: 'out-1',
      timestamp: '2026-09-24T10:00:00.000Z',
      causationId: 'input-1',
      causationSource: 'https://wallpaperdb/ingestor',
      correlationId: 'flow-1',
      variant: {
        wallpaperId: 'wp',
        width: 2,
        height: 2,
        fileSizeBytes: 20,
        format: 'image/png',
        createdAt: '2026-09-24T10:00:00.000Z',
      },
    },
  ];
  let completed = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'outbox-test',
    outboxPollMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsOutboxLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogOutbox, {
          listPending: () => Effect.succeed(pending.slice()),
          markPublished: () =>
            Effect.suspend(() => {
              completed++;
              if (completed === 1)
                return Effect.fail(
                  new CatalogFailure({ operation: 'mark', cause: 'ambiguous response' })
                );
              pending.splice(0);
              return Effect.void;
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(OutboxHealth);
    await expect.poll(() => pending.length).toBe(0);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const msg = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.variant.available',
    });
    expect(msg.header.get('ce-specversion')).toBe('1.0');
    expect(msg.header.get('ce-source')).toBe('https://wallpaperdb/media');
    expect(msg.header.get('ce-id')).toBe('out-1');
    expect(msg.header.get('ce-causationid')).toBe('input-1');
    expect(msg.header.get('ce-correlationid')).toBe('flow-1');
    expect(JSON.parse(new TextDecoder().decode(msg.data))).toEqual({
      eventId: 'out-1',
      eventType: 'wallpaper.variant.available',
      timestamp: '2026-09-24T10:00:00.000Z',
      variant: {
        wallpaperId: 'wp',
        width: 2,
        height: 2,
        aspectRatio: 1,
        fileSizeBytes: 20,
        format: 'image/png',
        createdAt: '2026-09-24T10:00:00.000Z',
      },
    });
    expect(completed).toBe(2);
  } finally {
    await runtime.dispose();
  }
});
it('keeps a rejected publication pending and resumes after broker capacity recovers', async () => {
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  await manager.streams.purge('WALLPAPER');
  await manager.streams.update('WALLPAPER', { discard: DiscardPolicy.New, max_msgs: 1 });
  await (await tester.nats.getJsClient()).publish('wallpaper.variant.available', 'full');
  const pending: AvailableNotification[] = [
    {
      id: 'out-capacity',
      timestamp: '2026-09-24T10:00:00.000Z',
      causationId: 'input-capacity',
      causationSource: 'https://wallpaperdb/ingestor',
      variant: {
        wallpaperId: 'wp',
        width: 2,
        height: 2,
        fileSizeBytes: 20,
        format: 'image/png',
        createdAt: '2026-09-24T10:00:00.000Z',
      },
    },
  ];
  let reads = 0;
  let marked = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'outbox-capacity',
    outboxPollMs: 20,
  };
  const runtime = ManagedRuntime.make(
    natsOutboxLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogOutbox, {
          listPending: () =>
            Effect.sync(() => {
              reads++;
              return pending.slice();
            }),
          markPublished: () =>
            Effect.sync(() => {
              marked++;
              pending.splice(0);
            }),
        })
      )
    )
  );
  try {
    const health = await runtime.runPromise(OutboxHealth);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    expect(await Effect.runPromise(health.check())).toBe(false);
    expect(marked).toBe(0);
    expect(pending).toHaveLength(1);
    await manager.streams.purge('WALLPAPER');
    await expect.poll(() => marked).toBe(1);
    await expect.poll(() => Effect.runPromise(health.check())).toBe(true);
    expect(
      (
        await manager.streams.getMessage('WALLPAPER', {
          last_by_subj: 'wallpaper.variant.available',
        })
      ).header.get('ce-id')
    ).toBe('out-capacity');
  } finally {
    await runtime.dispose();
    await manager.streams.update('WALLPAPER', { discard: DiscardPolicy.Old, max_msgs: -1 });
  }
});

it('reports outbox storage failure and returns healthy after the next successful poll', async () => {
  let unavailable = true;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'outbox-health',
    outboxPollMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsOutboxLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogOutbox, {
          listPending: () =>
            Effect.suspend(() =>
              unavailable
                ? Effect.fail(
                    new CatalogFailure({ operation: 'listPending', cause: 'database offline' })
                  )
                : Effect.succeed([])
            ),
          markPublished: () => Effect.void,
        })
      )
    )
  );
  try {
    const health = await runtime.runPromise(OutboxHealth);
    await expect.poll(() => Effect.runPromise(health.check())).toBe(false);
    unavailable = false;
    await expect.poll(() => Effect.runPromise(health.check())).toBe(true);
    unavailable = true;
    await expect.poll(() => Effect.runPromise(health.check())).toBe(false);
  } finally {
    await runtime.dispose();
  }
});
it('finishes its initial empty poll before reporting startup readiness', async () => {
  let polls = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'outbox-initialization',
    outboxPollMs: 60_000,
    shutdownTimeoutMs: 50,
  };
  const runtime = ManagedRuntime.make(
    natsOutboxLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogOutbox, {
          listPending: () =>
            Effect.sleep(25).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  polls++;
                  return [];
                })
              )
            ),
          markPublished: () => Effect.void,
        })
      )
    )
  );
  try {
    const health = await runtime.runPromise(OutboxHealth);
    expect(await Effect.runPromise(health.check())).toBe(true);
    expect(polls).toBe(1);
  } finally {
    await runtime.dispose();
  }
});
