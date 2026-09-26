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
  wallpaperId: input.wallpaperId, width: 1280, height: 720, aspectRatio: 1280 / 720,
  format: 'image/png' as const, fileSizeBytes: 10, storageBucket: 'wallpapers',
  storageKey: 'test/1280x720.png', createdAt: new Date(input.timestamp),
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
        wallpaperId: input.wallpaperId, width: 1280, height: 720,
        asset: { owner: 'variant-generator', id: 'wallpaper-test:1280x720:image/png' },
        createdAt: input.timestamp,
      },
    });
    expect(publication.variant).not.toHaveProperty('storageBucket');
    expect(publication.variant).not.toHaveProperty('storageKey');
    expect(message.header.get('ce-specversion')).toBe('1.0');
    expect(message.header.get('ce-correlationid')).toBe('workflow-test');
    expect(message.header.get('ce-causationid')).toBe(input.occurrence.id);
    expect(message.header.get('ce-causationsource')).toBe(input.occurrence.source);
    expect(message.json()).toMatchObject({ eventId: message.header.get('ce-id') });
    await runtime.runPromise(Effect.flatMap(VariantEvents, (events) => events.publish({
      input, variant: { ...variant, width: 640, height: 360, storageKey: 'test/640x360.png' },
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
