import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { WallpaperUploadedEventSchema } from '@wallpaperdb/events/schemas';
import { resolveAssetReference } from '@wallpaperdb/core/assets';
import { context, propagation, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Effect, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadEventsHealth, uploadedEventsLayer } from '../../src/adapters/events/index.js';
import { UploadEvents, type UploadedEvent } from '../../src/ingestion/index.js';

const occurrence: UploadedEvent = {
  id: 'upload-occurrence',
  source: 'urn:wallpaperdb:ingestor',
  occurredAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'request-123',
  causationId: 'request-123',
  wallpaper: {
    id: 'wlpr_events',
    profileId: 'user_events',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    originalFilename: 'image.png',
    metadata: {
      mimeType: 'image/png',
      fileType: 'image',
      width: 1920,
      height: 1080,
      fileSizeBytes: 123,
      contentHash: 'hash',
      extension: 'png',
    },
  },
};

describe('upload event publication', () => {
  const StorageTester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const storage = new StorageTester().withS3().withS3Bucket('asset-references');
  let container: StartedNatsContainer;
  let connection: NatsConnection;
  let runtime: ManagedRuntime.ManagedRuntime<UploadEvents | UploadEventsHealth, unknown>;
  beforeAll(async () => {
    await storage.setup();
    container = await createNatsContainer();
    const url = container.getConnectionUrl();
    connection = await connect({ servers: url });
    const manager = await connection.jetstreamManager();
    await manager.streams.add({ name: 'UPLOADS', subjects: ['wallpaper.uploaded'] });
    runtime = ManagedRuntime.make(
      uploadedEventsLayer({
        url,
        stream: 'UPLOADS',
        serviceName: 'ingestor-test',
        assetBucket: 'wallpapers',
        assetReferenceBucket: 'asset-references',
        endpoint: storage.s3.config.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: storage.s3.config.options.accessKey,
        secretAccessKey: storage.s3.config.options.secretKey,
      })
    );
  });
  afterAll(async () => {
    await runtime?.dispose();
    await connection?.close();
    await container?.stop();
    await storage.destroy();
  });
  it('confirms persistence and deduplicates retries using the original occurrence identity', async () => {
    expect(await runtime.runPromise(UploadEventsHealth.use((health) => health.check()))).toBe(true);
    const publish = UploadEvents.use((events) => events.publish(occurrence));
    await runtime.runPromise(publish);
    await runtime.runPromise(publish);
    const manager = await connection.jetstreamManager();
    expect((await manager.streams.info('UPLOADS')).state.messages).toBe(1);
    const message = await manager.streams.getMessage('UPLOADS', { seq: 1 });
    const envelope = JSON.parse(new TextDecoder().decode(message.data));
    expect(envelope).toMatchObject({
      specversion: '1.0',
      id: occurrence.id,
      source: occurrence.source,
      type: 'wallpaper.uploaded',
      time: occurrence.occurredAt,
      correlationid: occurrence.correlationId,
      causationid: occurrence.causationId,
    });
    expect(WallpaperUploadedEventSchema.parse(envelope)).toMatchObject({
      eventId: occurrence.id,
      wallpaper: {
        id: occurrence.wallpaper.id,
        userId: 'user_events',
        asset: { owner: 'ingestor', id: occurrence.wallpaper.id },
      },
    });
    expect(envelope.data.wallpaper).not.toHaveProperty('storageKey');
    expect(envelope.data.wallpaper).not.toHaveProperty('storageBucket');
    expect(envelope.data.wallpaper).not.toHaveProperty('originalFilename');
    expect(
      await resolveAssetReference(storage.s3.getS3Client(), 'asset-references', {
        owner: 'ingestor',
        id: occurrence.wallpaper.id,
      })
    ).toEqual({ bucket: 'wallpapers', key: 'wlpr_events/original.png' });
  });
  it('keeps an upload unpublished when its immutable reference cannot be registered', async () => {
    const unavailable = ManagedRuntime.make(
      uploadedEventsLayer({
        url: container.getConnectionUrl(),
        stream: 'UPLOADS',
        serviceName: 'ingestor-manifest-failure',
        assetBucket: 'wallpapers',
        assetReferenceBucket: 'missing-asset-references',
        endpoint: storage.s3.config.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: storage.s3.config.options.accessKey,
        secretAccessKey: storage.s3.config.options.secretKey,
      })
    );
    const manager = await connection.jetstreamManager();
    const before = (await manager.streams.info('UPLOADS')).state.messages;
    try {
      expect(
        await unavailable.runPromise(
          UploadEvents.use((events) =>
            events.publish({
              ...occurrence,
              id: 'unregistered-occurrence',
            })
          ).pipe(Effect.flip)
        )
      ).toMatchObject({
        _tag: 'IngestionUnavailable',
        operation: 'register-upload-asset',
      });
      expect((await manager.streams.info('UPLOADS')).state.messages).toBe(before);
    } finally {
      await unavailable.dispose();
    }
  });
  it('preserves durable trace context when publication resumes under another request', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const traceContext = {
      traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
      tracestate: 'ingestor=original',
    };
    try {
      await trace
        .getTracer('ingestor-contract')
        .startActiveSpan('different-request', async (span) => {
          try {
            await runtime.runPromise(
              UploadEvents.use((events) =>
                events.publish({ ...occurrence, id: 'durable-trace', traceContext })
              )
            );
          } finally {
            span.end();
          }
        });
      const manager = await connection.jetstreamManager();
      const message = await manager.streams.getMessage('UPLOADS', {
        last_by_subj: 'wallpaper.uploaded',
      });
      expect(message.header.get('traceparent')).toBe(traceContext.traceparent);
      expect(message.header.get('tracestate')).toBe(traceContext.tracestate);
    } finally {
      trace.disable();
      propagation.disable();
      context.disable();
      await provider.shutdown();
    }
  });
  it('reports permanent encoding failures and missing broker storage as technical failures', async () => {
    const events = await runtime.runPromise(UploadEvents);
    const invalid = {
      ...occurrence,
      wallpaper: {
        ...occurrence.wallpaper,
        metadata: { ...occurrence.wallpaper.metadata, width: 0 },
      },
    };
    expect(await Effect.runPromise(events.publish(invalid).pipe(Effect.flip))).toMatchObject({
      _tag: 'IngestionUnavailable',
      operation: 'encode-upload-event',
    });
    const manager = await connection.jetstreamManager();
    await manager.streams.delete('UPLOADS');
    expect(await runtime.runPromise(UploadEventsHealth.use((health) => health.check()))).toBe(
      false
    );
    expect(await Effect.runPromise(events.publish(occurrence).pipe(Effect.flip))).toMatchObject({
      _tag: 'IngestionUnavailable',
      operation: 'publish-upload-event',
    });
  });
});
