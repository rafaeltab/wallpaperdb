import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { ConsumerHealth, natsConsumerLayer } from '../src/adapters/events/index.js';
import {
  CatalogProjection,
  CatalogFailure,
  type ProjectionInput,
} from '../src/catalog/index.js';
const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((n) => n.withJetstream()).withStream('WALLPAPER').withStream('PROFILE');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
afterEach(async () => {
  await tester.nats.purgeAllStreams();
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  await manager.streams.purge('MEDIA_QUARANTINE');
  await manager.consumers.delete('WALLPAPER', 'media-wallpaper-uploaded-consumer');
 await manager.consumers.delete('WALLPAPER', 'media-wallpaper-variant-uploaded-consumer');
 await manager.consumers.delete('PROFILE', 'media-profile-picture-snapshots');
});
function upload(id: string, fileType: 'image' | 'video' = 'image') {
  return {
    eventId: id,
    eventType: 'wallpaper.uploaded',
    timestamp: '2026-09-24T10:00:00.000Z',
    wallpaper: {
      id: 'wp',
      userId: 'user',
      fileType,
      mimeType: 'image/png',
      fileSizeBytes: 20,
      width: 2,
      height: 2,
      aspectRatio: 1,
      storageBucket: 'wallpapers',
      storageKey: 'wp.png',
      originalFilename: 'wp.png',
      uploadedAt: '2026-09-24T10:00:00.000Z',
    },
  };
}
it('translates broker input, acknowledges successful and skipped generation, and closes idle workers', async () => {
  const calls: ProjectionInput[] = [];
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'consumer-contract',
    retryDelayMs: 10,
    shutdownTimeoutMs: 200,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return;
            }),
        })
      )
    )
  );
  try {
    expect(await runtime.runPromise(Effect.flatMap(ConsumerHealth, (h) => h.check()))).toBe(true);
    const js = await tester.nats.getJsClient();
    await js.publish('wallpaper.uploaded', JSON.stringify(upload('image')));
    await js.publish('wallpaper.uploaded', JSON.stringify(upload('video', 'video')));
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[0]).toMatchObject({kind:'wallpaper',wallpaper:{storageBucket:'wallpapers',storageKey:'wp.png'}});
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
            .num_ack_pending
      )
      .toBe(0);
  } finally {
    await runtime.dispose();
  }
});
it('quarantines invalid input and exhausted failures after exactly three delayed attempts', async () => {
  const attempts: number[] = [];
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'consumer-contract',
    retryDelayMs: 30,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.suspend(() => {
              attempts.push(Date.now());
              return Effect.fail(
                new CatalogFailure({ operation: 'controlled', cause: 'offline' })
              );
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const js = await tester.nats.getJsClient();
    await js.publish('wallpaper.uploaded', JSON.stringify(upload('failed')));
    await js.publish('wallpaper.uploaded', 'invalid json');
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('MEDIA_QUARANTINE')).state.messages, {
        timeout: 5000,
      })
      .toBe(2);
    expect(attempts).toHaveLength(3);
    expect((attempts[1] ?? 0) - (attempts[0] ?? 0)).toBeGreaterThanOrEqual(25);
    expect((attempts[2] ?? 0) - (attempts[1] ?? 0)).toBeGreaterThanOrEqual(50);
    const original = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    expect(original.header.get('ce-specversion')).toBe('1.0');
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
            .num_ack_pending
      )
      .toBe(0);
  } finally {
    await runtime.dispose();
  }
});

