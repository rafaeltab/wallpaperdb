import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { WallpaperVariantUploadedEventSchema } from '@wallpaperdb/events/schemas';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { VariantEvents, type GenerationInput } from '../src/generation/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((nats) => nats.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
const input: GenerationInput = {
  wallpaperId: 'wallpaper-test',
  fileType: 'image',
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
  storage: { bucket: 'wallpapers', key: 'test.png' },
  occurrence: { source: 'https://wallpaperdb/ingestor', id: 'uploaded-test' },
  timestamp: '2026-09-24T10:00:00.000Z',
  correlationId: 'workflow-test',
};

const variant = {
  target: { width: 854, height: 480 },
  wallpaperId: input.wallpaperId, width: 853, height: 480, aspectRatio: 853 / 480,
  format: 'image/png' as const, fileSizeBytes: 10, storageBucket: 'wallpapers',
  storageKey: 'test/854x480.png', createdAt: new Date(input.timestamp),
};

it('preserves retained coordinates and occurrence identity on durable replay', async () => {
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'events-contract',
    })
  );
  try {
    const publish = Effect.flatMap(VariantEvents, (events) =>
      events.publish({ input, variant })
    );
    await runtime.runPromise(publish);
    await runtime.runPromise(publish);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const message = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.variant.uploaded',
    });
    const publication = WallpaperVariantUploadedEventSchema.parse(message.json());
    expect(publication).toMatchObject({
      eventType: 'wallpaper.variant.uploaded',
      timestamp: input.timestamp,
      variant: {
        wallpaperId: input.wallpaperId, width: 853, height: 480, aspectRatio: 853 / 480,
        storageBucket: variant.storageBucket, storageKey: variant.storageKey,
        createdAt: input.timestamp,
      },
    });
    // The v1 occurrence identity remains the recorded preset target, not the encoded width.
    expect(publication.eventId).toBe('99e4ce16e144a967c03cf544500c52573ca489f058376cccf7e42efcd027de2d');
    expect(publication.variant).not.toHaveProperty('asset');
    expect(message.header.get('ce-specversion')).toBe('1.0');
    expect(message.header.get('ce-correlationid')).toBe('workflow-test');
    expect(message.header.get('ce-causationid')).toBe(input.occurrence.id);
    expect(message.header.get('ce-causationsource')).toBe(input.occurrence.source);
    expect(message.json()).toMatchObject({ eventId: message.header.get('ce-id') });
    await runtime.runPromise(Effect.flatMap(VariantEvents, (events) => events.publish({
      input, variant: { ...variant, target: { width: 640, height: 360 }, width: 640, height: 360, aspectRatio: 640 / 360, storageKey: 'test/640x360.png' },
    })));
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(2);
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
      Effect.flatMap(VariantEvents, (events) =>
        events.publish({
          input: { ...input, occurrence: { ...input.occurrence, id: 'rejected' } },
          variant,
        })
      ).pipe(Effect.result)
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure')
      expect(result.failure).toMatchObject({
        _tag: 'GenerationUnavailable',
        operation: 'publish-variant',
      });
  } finally {
    try {
      await manager.streams.update('WALLPAPER', { max_msg_size: originalMaxMessageSize });
    } finally {
      await runtime.dispose();
    }
  }
});

it('publishes logical references for current uploads using nominal target identity and actual pixels', async () => {
  const runtime = ManagedRuntime.make(natsEventsLayer({ url: tester.nats.config.endpoints.fromHost, stream: 'WALLPAPER', serviceName: 'logical-contract' }));
  const logicalInput: GenerationInput = { ...input, storage: { owner: 'ingestor', id: input.wallpaperId }, occurrence: { ...input.occurrence, id: 'logical-publication' } };
  try {
    await runtime.runPromise(VariantEvents.use((events) => events.publish({ input: logicalInput, variant: { ...variant, storageKey: `${input.wallpaperId}/variant_854x480.png` } })));
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const message = await manager.streams.getMessage('WALLPAPER', { last_by_subj: 'wallpaper.variant.uploaded' });
    const event = WallpaperVariantUploadedEventSchema.parse(message.json());
    expect(event.variant).toMatchObject({ width: 853, height: 480, asset: { owner: 'variant-generator', id: 'wallpaper-test:854x480:image/png' } });
    expect(event.variant).not.toHaveProperty('storageBucket');
    expect(event.variant).not.toHaveProperty('storageKey');
  } finally { await runtime.dispose(); }
});
