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
  ExtractColors,
  ExtractionUnavailable,
  type ExtractionInput,
} from '../src/extraction/index.js';
const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((n) => n.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
afterEach(async () => {
  await tester.nats.purgeAllStreams();
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  await manager.streams.purge('COLOR_EXTRACTOR_QUARANTINE');
  await manager.consumers.delete('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer');
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
it('translates broker input, acknowledges successful and skipped extraction, and closes idle workers', async () => {
  const calls: ExtractionInput[] = [];
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
        Layer.succeed(ExtractColors, {
          extract: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return { _tag: input.fileType === 'video' ? 'Skipped' : 'Extracted' };
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
    expect(calls[0]?.storage).toEqual({ bucket: 'wallpapers', key: 'wp.png' });
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
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
        Layer.succeed(ExtractColors, {
          extract: () =>
            Effect.suspend(() => {
              attempts.push(Date.now());
              return Effect.fail(
                new ExtractionUnavailable({ operation: 'controlled', cause: 'offline' })
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
      .poll(async () => (await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).state.messages, {
        timeout: 5000,
      })
      .toBe(2);
    expect(attempts).toHaveLength(3);
    expect((attempts[1] ?? 0) - (attempts[0] ?? 0)).toBeGreaterThanOrEqual(25);
    expect((attempts[2] ?? 0) - (attempts[1] ?? 0)).toBeGreaterThanOrEqual(50);
    const original = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
      last_by_subj: 'color-extractor.quarantine',
    });
    expect(original.header.get('ce-specversion')).toBe('1.0');
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .num_ack_pending
      )
      .toBe(0);
  } finally {
    await runtime.dispose();
  }
});

it('keeps exhausted input pending until quarantine accepts it without processing a fourth time', async () => {
  let attempts = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'consumer-contract',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(ExtractColors, {
          extract: () =>
            Effect.suspend(() => {
              attempts++;
              return Effect.fail(
                new ExtractionUnavailable({ operation: 'controlled', cause: 'offline' })
              );
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const js = await tester.nats.getJsClient();
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', { max_msgs: 1 });
    await js.publish('color-extractor.quarantine', 'full');
    await js.publish('wallpaper.uploaded', JSON.stringify(upload('retry-quarantine')));
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .delivered.consumer_seq,
        { timeout: 5000 }
      )
      .toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(3);
    expect(
      (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
    await manager.streams.purge('COLOR_EXTRACTOR_QUARANTINE');
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .num_ack_pending,
        { timeout: 5000 }
      )
      .toBe(0);
    expect(attempts).toBe(3);
    const stored = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
      last_by_subj: 'color-extractor.quarantine',
    });
    expect(stored.json()).toEqual(upload('retry-quarantine'));
    expect(stored.header.get('ce-reason')).toBe('Exhausted');
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', { max_msgs: -1 });
  } finally {
    await runtime.dispose();
  }
});
it('interrupts unfinished extraction at the shutdown bound and leaves input retryable', async () => {
  let started = false;
  let interrupted = false;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'consumer-contract',
    retryDelayMs: 10,
    shutdownTimeoutMs: 30,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(ExtractColors, {
          extract: () =>
            Effect.sync(() => {
              started = true;
            }).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                })
              )
            ),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      JSON.stringify(upload('shutdown'))
    );
    await expect.poll(() => started).toBe(true);
    const before = Date.now();
    await runtime.dispose();
    expect(Date.now() - before).toBeLessThan(1500);
    expect(interrupted).toBe(true);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect(
      (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
  } finally {
    await runtime.dispose();
  }
});
it('quarantines malformed 64 KiB payloads byte for byte without invoking extraction', async () => {
  const calls: ExtractionInput[] = [];
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'consumer-contract',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(ExtractColors, {
          extract: (input) =>
            Effect.sync(() => {
              calls.push(input);
            }).pipe(Effect.andThen(Effect.die('Invalid input must not cross the driving port'))),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const payload = new Uint8Array(64 * 1024).fill(255);
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).state.messages)
      .toBe(1);
    const message = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
      last_by_subj: 'color-extractor.quarantine',
    });
    expect(message.data).toEqual(payload);
    expect(calls).toHaveLength(0);
    expect(message.header.get('ce-reason')).toBe('Invalid');
  } finally {
    await runtime.dispose();
  }
});
