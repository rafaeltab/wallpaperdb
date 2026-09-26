import { AckPolicy, DeliverPolicy, headers } from 'nats';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { NatsBroker, natsEventsLayer } from '../src/adapters/events/index.js';
import { ConsumerHealth, natsConsumerLayer } from '../src/adapters/events/index.js';
import { CatalogProjection, CatalogFailure, type ProjectionInput } from '../src/catalog/index.js';
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
const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester()
  .withNats((n) => n.withJetstream())
  .withStream('WALLPAPER')
  .withStream('PROFILE');
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
    expect(calls[0]).toMatchObject({
      kind: 'wallpaper',
      wallpaper: { storageBucket: 'wallpapers', storageKey: 'wp.png' },
    });
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
              return Effect.fail(new CatalogFailure({ operation: 'controlled', cause: 'offline' }));
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
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.suspend(() => {
              attempts++;
              return Effect.fail(new CatalogFailure({ operation: 'controlled', cause: 'offline' }));
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const js = await tester.nats.getJsClient();
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.streams.update('MEDIA_QUARANTINE', { max_msgs: 1 });
    await js.publish('media.quarantine', 'full');
    await js.publish('wallpaper.uploaded', JSON.stringify(upload('retry-quarantine')));
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer')).delivered
            .consumer_seq,
        { timeout: 5000 }
      )
      .toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(3);
    expect(
      (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
    await manager.streams.purge('MEDIA_QUARANTINE');
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
            .num_ack_pending,
        { timeout: 5000 }
      )
      .toBe(0);
    expect(attempts).toBe(3);
    const stored = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    expect(stored.json()).toEqual(upload('retry-quarantine'));
    expect(stored.header.get('ce-reason')).toBe('Exhausted');
    await manager.streams.update('MEDIA_QUARANTINE', { max_msgs: -1 });
  } finally {
    await runtime.dispose();
  }
});
it('interrupts unfinished generation at the shutdown bound and leaves input retryable', async () => {
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
        Layer.succeed(CatalogProjection, {
          accept: () =>
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
      (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
  } finally {
    await runtime.dispose();
  }
});
it('quarantines malformed 64 KiB payloads byte for byte without invoking generation', async () => {
  const calls: ProjectionInput[] = [];
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
        Layer.succeed(CatalogProjection, {
          accept: (input) =>
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
      .poll(async () => (await manager.streams.info('MEDIA_QUARANTINE')).state.messages)
      .toBe(1);
    const message = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    expect(message.data).toEqual(payload);
    expect(calls).toHaveLength(0);
    expect(message.header.get('ce-reason')).toBe('Invalid');
  } finally {
    await runtime.dispose();
  }
});

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
        Layer.succeed(CatalogProjection, {
          accept: () => Effect.die('Invalid input must not cross the driving port'),
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
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer')).ack_floor
            .consumer_seq,
        { timeout: 3000 }
      )
      .toBe(1);
    const info = await manager.streams.info('MEDIA_QUARANTINE');
    const manifestMessage = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    const manifest = decodeManifest(manifestMessage.json());
    expect(manifestMessage.header.get('ce-type')).toBe('media.upload.quarantine-manifest');
    const chunks: Uint8Array[] = [];
    for (let sequence = info.state.first_seq; sequence < info.state.last_seq; sequence++) {
      const chunk = await manager.streams.getMessage('MEDIA_QUARANTINE', { seq: sequence });
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
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.suspend(() => {
              attempts++;
              return Effect.fail(new CatalogFailure({ operation: 'controlled', cause: 'offline' }));
            }),
        })
      )
    )
  );
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await manager.streams.update('MEDIA_QUARANTINE', { max_msg_size: 2048, max_msgs: 1 });
    const event = upload('partial-quarantine');
    event.wallpaper.originalFilename = 'x'.repeat(8192);
    const payload = new TextEncoder().encode(JSON.stringify(event));
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer')).delivered
            .consumer_seq,
        { timeout: 5000 }
      )
      .toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(3);
    expect((await manager.streams.info('MEDIA_QUARANTINE')).state.messages).toBe(1);
    expect(
      (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
    if (purgePartial) await manager.streams.purge('MEDIA_QUARANTINE');
    await manager.streams.update('MEDIA_QUARANTINE', { max_msgs: -1 });
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
            .num_ack_pending,
        { timeout: 5000 }
      )
      .toBe(0);
    expect(attempts).toBe(3);
    const manifest = decodeManifest(
      (
        await manager.streams.getMessage('MEDIA_QUARANTINE', {
          last_by_subj: 'media.quarantine',
        })
      ).json()
    );
    const chunks = await Promise.all(
      manifest.sequences.map(
        async (seq: number) => (await manager.streams.getMessage('MEDIA_QUARANTINE', { seq })).data
      )
    );
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
    expect((await manager.streams.info('MEDIA_QUARANTINE')).state.messages).toBe(
      manifest.chunkCount + 1
    );
  } finally {
    await runtime.dispose();
    await manager.streams.update('MEDIA_QUARANTINE', { max_msg_size: -1, max_msgs: -1 });
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
        Layer.provide(Layer.succeed(CatalogProjection, { accept: () => Effect.die('no input') }))
      )
    );
  const initial = makeRuntime();
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  await initial.runPromise(ConsumerHealth);
  await initial.dispose();
  const config = (await manager.streams.info('MEDIA_QUARANTINE')).config;
  expect(config).toMatchObject({
    retention: 'limits',
    storage: 'file',
    discard: 'new',
    max_bytes: 1024 * 1024 * 1024,
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
  });
  await manager.streams.update('MEDIA_QUARANTINE', override);
  const incompatible = makeRuntime();
  try {
    await expect(incompatible.runPromise(ConsumerHealth)).rejects.toMatchObject({
      _tag: 'BrokerFailure',
      operation: 'configure-quarantine',
    });
    expect((await manager.streams.info('MEDIA_QUARANTINE')).config).toMatchObject(override);
  } finally {
    await incompatible.dispose();
    await manager.streams.update('MEDIA_QUARANTINE', {
      max_bytes: 1024 * 1024 * 1024,
      max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
      max_msgs_per_subject: -1,
    });
  }
});

it.each([
  128, 1024,
])('keeps input pending when a %i-byte limit cannot hold its durable envelope', async (maxMessageSize) => {
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'quarantine-envelope-contract',
    retryDelayMs: 20,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () => Effect.die('invalid input must never generate'),
        })
      )
    )
  );
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await manager.streams.update('MEDIA_QUARANTINE', { max_msg_size: maxMessageSize });
    await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      new Uint8Array(64 * 1024).fill(255)
    );
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer')).delivered
            .consumer_seq
      )
      .toBeGreaterThanOrEqual(2);
    expect((await manager.streams.info('MEDIA_QUARANTINE')).state.messages).toBe(0);
    expect(
      (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(1);
    await manager.streams.update('MEDIA_QUARANTINE', { max_msg_size: -1 });
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
            .num_ack_pending
      )
      .toBe(0);
  } finally {
    await runtime.dispose();
    await manager.streams.update('MEDIA_QUARANTINE', { max_msg_size: -1 });
  }
});

it.each([
  'single',
  'manifest',
  'chunk',
] as const)('repairs deleted %s records even while their publication IDs remain deduplicated', async (deletedRecord) => {
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'quarantine-repair-contract',
  };
  const makeRuntime = () =>
    ManagedRuntime.make(
      natsConsumerLayer(options).pipe(
        Layer.provide(natsEventsLayer(options)),
        Layer.provide(
          Layer.succeed(CatalogProjection, {
            accept: () => Effect.die('Invalid input must not generate'),
          })
        )
      )
    );
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const stream = 'MEDIA_QUARANTINE';
  const durable = 'media-wallpaper-uploaded-consumer';
  const first = makeRuntime();
  const replay = makeRuntime();
  try {
    await first.runPromise(ConsumerHealth);
    await manager.streams.update(stream, { max_msg_size: deletedRecord === 'single' ? -1 : 2048 });
    const payload = new Uint8Array(deletedRecord === 'single' ? 32 : 8192).fill(255);
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
    await expect
      .poll(async () => (await manager.consumers.info('WALLPAPER', durable)).ack_floor.consumer_seq)
      .toBe(1);
    await first.dispose();
    const stored = await manager.streams.getMessage(stream, { last_by_subj: 'media.quarantine' });
    if (deletedRecord === 'single') await manager.streams.purge(stream);
    else {
      const manifest = decodeManifest(stored.json());
      const sequence = deletedRecord === 'manifest' ? stored.seq : manifest.sequences[0];
      if (sequence === undefined) throw new Error('Expected a chunk sequence');
      await manager.streams.deleteMessage(stream, sequence);
    }
    // Recreate the durable consumer to replay the retained input with its original identity.
    await manager.consumers.delete('WALLPAPER', durable);
    await replay.runPromise(ConsumerHealth);
    await expect
      .poll(async () => (await manager.consumers.info('WALLPAPER', durable)).ack_floor.consumer_seq)
      .toBe(1);
    const repaired = await manager.streams.getMessage(stream, { last_by_subj: 'media.quarantine' });
    expect(repaired.header.get('ce-id')).toBe(stored.header.get('ce-id'));
    if (deletedRecord === 'single') expect(repaired.data).toEqual(payload);
    else {
      const manifest = decodeManifest(repaired.json());
      const chunks = await Promise.all(
        manifest.sequences.map(
          async (seq) => (await manager.streams.getMessage(stream, { seq })).data
        )
      );
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
    }
  } finally {
    await first.dispose();
    await replay.dispose();
    await manager.streams.update(stream, { max_msg_size: -1 });
  }
});
it('allows an in-flight projection to commit and acknowledge before closing its connection', async () => {
  const release = Effect.runSync(Deferred.make<void>());
  let started = false;
  let completed = false;
  let interrupted = false;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'graceful',
    shutdownTimeoutMs: 1000,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provideMerge(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.gen(function* () {
              started = true;
              yield* Deferred.await(release);
              completed = true;
            }).pipe(
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
    const health = await runtime.runPromise(ConsumerHealth);
    const service = await runtime.runPromise(NatsBroker);
    await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      JSON.stringify(upload('graceful'))
    );
    await expect.poll(() => started).toBe(true);
    const disposed = runtime.dispose();
    await expect.poll(() => Effect.runPromise(health.check())).toBe(false);
    expect(service.connection.isClosed()).toBe(false);
    expect(completed).toBe(false);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await disposed;
    expect(completed).toBe(true);
    expect(interrupted).toBe(false);
    expect(service.connection.isClosed()).toBe(true);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect(
      (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer'))
        .num_ack_pending
    ).toBe(0);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await runtime.dispose();
  }
});
it('retains the original binary CloudEvent identity in quarantine for replay', async () => {
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'identity',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.fail(new CatalogFailure({ operation: 'controlled', cause: 'offline' })),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const metadata = headers();
    for (const [key, value] of Object.entries({
      'ce-specversion': '1.0',
      'ce-source': 'https://producer.example/events',
      'ce-id': 'original-1',
      'ce-type': 'wallpaper.uploaded',
      'ce-time': '2026-09-24T10:00:00.000Z',
      'ce-correlationid': 'flow-1',
    }))
      metadata.set(key, value);
    await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      JSON.stringify(upload('original-1')),
      { headers: metadata }
    );
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer')).ack_floor
            .consumer_seq
      )
      .toBe(3);
    const stored = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    expect(stored.header.get('original-ce-source')).toBe('https://producer.example/events');
    expect(stored.header.get('original-ce-id')).toBe('original-1');
    expect(stored.header.get('original-ce-correlationid')).toBe('flow-1');
  } finally {
    await runtime.dispose();
  }
});
it('requires coordinated recreation before replaying deliveries exhausted by a legacy consumer', async () => {
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const client = await tester.nats.getJsClient();
  const durable = 'media-wallpaper-uploaded-consumer';
  await manager.consumers.add('WALLPAPER', {
    durable_name: durable,
    ack_policy: AckPolicy.Explicit,
    ack_wait: 50_000_000,
    max_deliver: 3,
    filter_subject: 'wallpaper.uploaded',
  });
  await client.publish('wallpaper.uploaded', JSON.stringify(upload('legacy-exhausted')));
  const old = await client.consumers.get('WALLPAPER', durable);
  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await old.next({ expires: 1000 });
    if (!message) throw new Error('Expected legacy delivery');
    message.nak();
  }
  // Asking for another message lets the server reach MaxDeliver and stop the old work.
  expect(await old.next({ expires: 1000 })).toBeNull();
  let projected = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'legacy-recovery',
    retryDelayMs: 10,
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.suspend(() => {
              projected++;
              return Effect.fail(
                new CatalogFailure({ operation: 'offline', cause: 'unavailable' })
              );
            }),
        })
      )
    )
  );
  let recovered: typeof runtime | undefined;
  try {
    await expect(runtime.runPromise(ConsumerHealth)).rejects.toMatchObject({
      _tag: 'BrokerFailure',
      operation: 'migrate-legacy-consumer',
    });
    const retained = await manager.consumers.info('WALLPAPER', durable);
    expect(retained.config.max_deliver).toBe(3);
    await runtime.dispose();
    // Operator step with every media replica stopped: retain the durable name and
    // replay from the first sequence not covered by its contiguous acknowledgement floor.
    await manager.consumers.delete('WALLPAPER', durable);
    await manager.consumers.add('WALLPAPER', {
      durable_name: durable,
      ack_policy: AckPolicy.Explicit,
      max_deliver: -1,
      filter_subject: 'wallpaper.uploaded',
      deliver_policy: DeliverPolicy.StartSequence,
      opt_start_seq: retained.ack_floor.stream_seq + 1,
    });
    recovered = ManagedRuntime.make(
      natsConsumerLayer(options).pipe(
        Layer.provide(natsEventsLayer(options)),
        Layer.provide(
          Layer.succeed(CatalogProjection, {
            accept: () =>
              Effect.suspend(() => {
                projected++;
                return Effect.fail(
                  new CatalogFailure({ operation: 'offline', cause: 'unavailable' })
                );
              }),
          })
        )
      )
    );
    await recovered.runPromise(ConsumerHealth);
    await expect
      .poll(async () => (await manager.streams.info('MEDIA_QUARANTINE')).state.messages, {
        timeout: 3000,
      })
      .toBe(1);
    expect(projected).toBe(3);
    expect(
      (
        await manager.streams.getMessage('MEDIA_QUARANTINE', { last_by_subj: 'media.quarantine' })
      ).json()
    ).toEqual(upload('legacy-exhausted'));
    await expect
      .poll(async () => (await manager.consumers.info('WALLPAPER', durable)).num_ack_pending)
      .toBe(0);
  } finally {
    await runtime.dispose();
    await recovered?.dispose();
  }
});
it('upgrades a legacy consumer with no retained redeliveries without replacing its acknowledgement floor', async () => {
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const client = await tester.nats.getJsClient();
  const durable = 'media-wallpaper-uploaded-consumer';
  await manager.consumers.add('WALLPAPER', {
    durable_name: durable,
    ack_policy: AckPolicy.Explicit,
    ack_wait: 30_000_000_000,
    max_deliver: 4,
    filter_subject: 'wallpaper.uploaded',
  });
  await client.publish('wallpaper.uploaded', JSON.stringify(upload('already-done')));
  const message = await (await client.consumers.get('WALLPAPER', durable)).next({ expires: 1000 });
  if (!message) throw new Error('Expected initial legacy delivery');
  await message.ackAck();
  const before = await manager.consumers.info('WALLPAPER', durable);
  let projected = 0;
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'legacy-clean',
  };
  const runtime = ManagedRuntime.make(
    natsConsumerLayer(options).pipe(
      Layer.provide(natsEventsLayer(options)),
      Layer.provide(
        Layer.succeed(CatalogProjection, {
          accept: () =>
            Effect.sync(() => {
              projected++;
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(ConsumerHealth);
    const upgraded = await manager.consumers.info('WALLPAPER', durable);
    expect(upgraded.created).toBe(before.created);
    expect(upgraded.config.max_deliver).toBe(-1);
    expect(upgraded.ack_floor.stream_seq).toBe(before.ack_floor.stream_seq);
    await client.publish('wallpaper.uploaded', JSON.stringify(upload('new-work')));
    await expect.poll(() => projected).toBe(1);
  } finally {
    await runtime.dispose();
  }
});
