import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { headers } from 'nats';
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

it('preserves binary occurrence metadata through quarantine and successful operator replay', async () => {
  const calls: ExtractionInput[] = [];
  let unavailable = true;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'binary-replay-contract',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(ExtractColors, {
          extract: (input) =>
            Effect.suspend(() => {
              calls.push(input);
              return unavailable
                ? Effect.fail(
                    new ExtractionUnavailable({ operation: 'controlled', cause: 'offline' })
                  )
                : Effect.succeed({ _tag: 'Extracted' as const });
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const event = upload('binary-replay');
    const metadata = headers();
    const originalHeaders = {
      specversion: '1.0',
      source: 'https://wallpaperdb/ingestor',
      id: event.eventId,
      type: event.eventType,
      time: event.timestamp,
      correlationid: 'upload-flow',
      causationid: 'upload-command',
    };
    for (const [key, value] of Object.entries(originalHeaders)) metadata.set(`ce-${key}`, value);
    const js = await tester.nats.getJsClient();
    const bytes = new TextEncoder().encode(JSON.stringify(event));
    await js.publish('wallpaper.uploaded', bytes, { headers: metadata });
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).state.messages)
      .toBe(1);
    const stored = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
      last_by_subj: 'color-extractor.quarantine',
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      occurrence: { source: originalHeaders.source, id: event.eventId },
      correlationId: 'upload-flow',
    });
    expect(stored.data).toEqual(bytes);
    const replayHeaders = headers();
    for (const [key, value] of Object.entries(originalHeaders)) {
      expect(stored.header.get(`original-ce-${key}`)).toBe(value);
      replayHeaders.set(`ce-${key}`, stored.header.get(`original-ce-${key}`));
    }
    unavailable = false;
    await js.publish('wallpaper.uploaded', stored.data, { headers: replayHeaders });
    await expect.poll(() => calls.length).toBe(4);
    expect(calls[3]).toEqual(calls[0]);
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

it.each([
  { max_bytes: -1 },
  { max_age: 300 * 1_000_000_000 },
  { max_msgs_per_subject: 1 },
])('refuses incompatible quarantine policy %j without overwriting it', async (override) => {
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'quarantine-config-contract',
  };
  const makeRuntime = () =>
    ManagedRuntime.make(
      natsConsumerLayer(options).pipe(
        Layer.provide(natsEventsLayer(options)),
        Layer.provide(Layer.succeed(ExtractColors, { extract: () => Effect.die('no input') }))
      )
    );
  const initial = makeRuntime();
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  await initial.runPromise(ConsumerHealth);
  await initial.dispose();
  const config = (await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).config;
  expect(config).toMatchObject({
    retention: 'limits',
    storage: 'file',
    discard: 'new',
    max_bytes: 1024 * 1024 * 1024,
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
  });
  await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', override);
  const incompatible = makeRuntime();
  try {
    await expect(incompatible.runPromise(ConsumerHealth)).rejects.toMatchObject({
      _tag: 'ExtractionUnavailable',
      operation: 'configure-quarantine',
    });
    expect((await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).config).toMatchObject(
      override
    );
  } finally {
    await incompatible.dispose();
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', {
      max_bytes: 1024 * 1024 * 1024,
      max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
      max_msgs_per_subject: -1,
    });
  }
});

const decodeManifest = Schema.decodeUnknownSync(
  Schema.Struct({
    quarantineId: Schema.String,
    chunkCount: Schema.Number,
    chunkSize: Schema.Number,
    totalBytes: Schema.Number,
    sha256: Schema.String,
    sequences: Schema.Array(Schema.Number),
  })
);
it('durably quarantines an invalid body at the broker payload limit without losing bytes', async () => {
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'quarantine-limit-contract',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(ExtractColors, {
          extract: () => Effect.die('Invalid input must not cross the driving port'),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const connection = await tester.nats.getConnection();
    const limit = connection.info?.max_payload;
    if (!limit) throw new Error('Broker did not advertise its payload limit');
    const payload = new Uint8Array(limit).fill(255);
    const manager = await connection.jetstreamManager();
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .ack_floor.consumer_seq,
        { timeout: 3000 }
      )
      .toBe(1);
    const info = await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE');
    const manifestMessage = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
      last_by_subj: 'color-extractor.quarantine',
    });
    const manifest = decodeManifest(manifestMessage.json());
    expect(manifestMessage.header.get('ce-type')).toBe(
      'color-extractor.upload.quarantine-manifest'
    );
    const chunks: Uint8Array[] = [];
    for (let sequence = info.state.first_seq; sequence < info.state.last_seq; sequence++) {
      const chunk = await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
        seq: sequence,
      });
      expect(chunk.header.get('ce-quarantineid')).toBe(manifest.quarantineId);
      expect(chunk.header.get('ce-chunkindex')).toBe(String(chunks.length));
      chunks.push(chunk.data);
    }
    expect(chunks).toHaveLength(manifest.chunkCount);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
  } finally {
    await runtime.dispose();
  }
});

it.each([
  false,
  true,
])('resumes a rejected chunk handoff after capacity recovery (purge partial records: %s)', async (purgePartial) => {
  let attempts = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'quarantine-partial-contract',
    retryDelayMs: 20,
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
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', { max_msg_size: 2048, max_msgs: 1 });
    const event = upload('partial-quarantine');
    event.wallpaper.originalFilename = 'x'.repeat(8192);
    const payload = new TextEncoder().encode(JSON.stringify(event));
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .delivered.consumer_seq,
        { timeout: 5000 }
      )
      .toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(3);
    expect((await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).state.messages).toBe(1);
    expect(
      (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
    if (purgePartial) await manager.streams.purge('COLOR_EXTRACTOR_QUARANTINE');
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', { max_msgs: -1 });
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .num_ack_pending,
        { timeout: 5000 }
      )
      .toBe(0);
    expect(attempts).toBe(3);
    const manifest = decodeManifest(
      (
        await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', {
          last_by_subj: 'color-extractor.quarantine',
        })
      ).json()
    );
    const chunks = await Promise.all(
      manifest.sequences.map(
        async (seq: number) =>
          (await manager.streams.getMessage('COLOR_EXTRACTOR_QUARANTINE', { seq })).data
      )
    );
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
    expect((await manager.streams.info('COLOR_EXTRACTOR_QUARANTINE')).state.messages).toBe(
      manifest.chunkCount + 1
    );
  } finally {
    await runtime.dispose();
    await manager.streams.update('COLOR_EXTRACTOR_QUARANTINE', { max_msg_size: -1, max_msgs: -1 });
  }
});
