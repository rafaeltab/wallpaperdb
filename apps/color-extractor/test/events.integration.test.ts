import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { ColorEvents, type ExtractionInput } from '../src/capabilities/extraction/index.js';
import { WallpaperColorsExtractedCloudEventSchema } from '@wallpaperdb/events';
import { measuredImage } from './fixtures/measurements.js';
import { AckPolicy, RetentionPolicy } from 'nats';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((nats) => nats.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
const input: ExtractionInput = {
  wallpaperId: 'wallpaper-test',
  fileType: 'image',
  storage: { bucket: 'wallpapers', key: 'test.png' },
  occurrence: { source: 'https://wallpaperdb/ingestor', id: 'uploaded-test' },
  timestamp: '2026-09-24T10:00:00.000Z',
  correlationId: 'workflow-test',
};

it('awaits durable publication and preserves occurrence identity on replay', async () => {
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'events-contract',
    })
  );
  try {
    const publish = Effect.flatMap(ColorEvents, (events) =>
      events.publish({ input, ...measuredImage() })
    );
    await runtime.runPromise(publish);
    await runtime.runPromise(publish);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    expect((await manager.streams.info('WALLPAPER')).config.retention).toBe(RetentionPolicy.Limits);
    const message = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.colors.extracted',
    });
    expect(message.json()).toMatchObject({
      specversion: '1.0',
      type: 'wallpaper.colors.extracted',
      time: input.timestamp,
      correlationid: 'workflow-test',
      causationid: input.occurrence.id,
      data: {
        wallpaperId: input.wallpaperId,
        schemaVersion: 1,
        original: { owner: 'ingestor', id: input.wallpaperId },
        measurements: measuredImage().measurements,
      },
    });
    expect(WallpaperColorsExtractedCloudEventSchema.safeParse(message.json()).success).toBe(true);
    expect(
      message.data.byteLength + Buffer.byteLength(message.header?.toString() ?? '')
    ).toBeLessThanOrEqual(65536);
    await manager.consumers.add('WALLPAPER', {
      durable_name: 'measurement-replay',
      ack_policy: AckPolicy.Explicit,
      filter_subject: 'wallpaper.colors.extracted',
    });
    const consumer = await (await tester.nats.getJsClient()).consumers.get(
      'WALLPAPER',
      'measurement-replay'
    );
    const delivered = await consumer.next({ expires: 5000 });
    if (!delivered) throw new Error('Measurement was not replayable');
    await delivered.ackAck();
    expect((await manager.streams.getMessage('WALLPAPER', { seq: message.seq })).data).toEqual(
      message.data
    );
  } finally {
    await runtime.dispose();
  }
});

it('fits a dense bank and bounded occurrence metadata in the production 64 KiB message limit', async () => {
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const { max_msg_size: previous } = (await manager.streams.info('WALLPAPER')).config;
  await manager.streams.update('WALLPAPER', { max_msg_size: 65536 });
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'size-contract',
    })
  );
  const image = measuredImage();
  const dense = {
    ...image.measurements,
    layers: image.measurements.layers.map((layer) => ({
      ...layer,
      coverage: Array<number>(256).fill(10000),
      quality: Array<number>(256).fill(Math.fround(0.9001001)),
    })),
  };
  try {
    await runtime.runPromise(
      Effect.flatMap(ColorEvents, (events) =>
        events.publish({
          input: {
            ...input,
            wallpaperId: 'x'.repeat(255),
            occurrence: { source: 's'.repeat(1024), id: 'i'.repeat(1024) },
            correlationId: 'c'.repeat(1024),
          },
          originalSha256: image.originalSha256,
          measurements: dense,
        })
      )
    );
    const stored = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.colors.extracted',
    });
    const bytes = stored.data.byteLength + Buffer.byteLength(stored.header?.toString() ?? '');
    expect(bytes).toBeLessThanOrEqual(65536);
    expect(WallpaperColorsExtractedCloudEventSchema.safeParse(stored.json()).success).toBe(true);
  } finally {
    await runtime.dispose();
    await manager.streams.update('WALLPAPER', { max_msg_size: previous });
  }
});

it('rejects invalid measurements and mismatched original identity before publishing', async () => {
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'validation-contract',
    })
  );
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const before = (await manager.streams.info('WALLPAPER')).state.messages;
  try {
    for (const result of [
      { input, ...measuredImage(), measurements: { ...measuredImage().measurements, layers: [] } },
      {
        input: {
          ...input,
          storage: { owner: 'ingestor' as const, id: 'different', mimeType: 'image/png' },
        },
        ...measuredImage(),
      },
    ]) {
      expect(
        await runtime.runPromise(
          Effect.flatMap(ColorEvents, (events) => events.publish(result)).pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ExtractionUnavailable', operation: 'validate-colors' },
      });
    }
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(before);
  } finally {
    await runtime.dispose();
  }
});
it('reports rejected publication as a typed failure without claiming completion', async () => {
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'events-contract',
    })
  );
  const manager = await (await tester.nats.getConnection()).jetstreamManager();
  const { max_msg_size: originalMaxMessageSize } = (await manager.streams.info('WALLPAPER')).config;
  try {
    await manager.streams.update('WALLPAPER', { max_msg_size: 1 });
    const result = await runtime.runPromise(
      Effect.flatMap(ColorEvents, (events) =>
        events.publish({
          input: { ...input, occurrence: { ...input.occurrence, id: 'rejected' } },
          ...measuredImage(),
        })
      ).pipe(Effect.result)
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure')
      expect(result.failure).toMatchObject({
        _tag: 'ExtractionUnavailable',
        operation: 'publish-colors',
      });
  } finally {
    try {
      await manager.streams.update('WALLPAPER', { max_msg_size: originalMaxMessageSize });
    } finally {
      await runtime.dispose();
    }
  }
});
