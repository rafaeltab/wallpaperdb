import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { WallpaperUploadedEventSchema } from '@wallpaperdb/events/schemas';
import { Effect, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadEventsHealth, uploadedEventsLayer } from '../../src/adapters/events/index.js';
import { UploadEvents, type UploadedEvent } from '../../src/ingestion/index.js';

const occurrence: UploadedEvent = {
  id: 'upload-occurrence', source: 'urn:wallpaperdb:ingestor',
  occurredAt: '2026-01-01T00:00:00.000Z', correlationId: 'request-123', causationId: 'request-123',
  wallpaper: {
    id: 'wlpr_events', profileId: 'user_events', uploadedAt: '2026-01-01T00:00:00.000Z',
    originalFilename: 'image.png', metadata: {
      mimeType: 'image/png', fileType: 'image', width: 1920, height: 1080, fileSizeBytes: 123,
      contentHash: 'hash', extension: 'png',
    },
  },
};

describe('upload event publication', () => {
  let container: StartedNatsContainer;
  let connection: NatsConnection;
  let runtime: ManagedRuntime.ManagedRuntime<UploadEvents | UploadEventsHealth, unknown>;
  beforeAll(async () => {
    container = await createNatsContainer();
    const url = container.getConnectionUrl();
    connection = await connect({ servers: url });
    const manager = await connection.jetstreamManager();
    await manager.streams.add({ name: 'UPLOADS', subjects: ['wallpaper.uploaded'] });
    runtime = ManagedRuntime.make(uploadedEventsLayer({
      url, stream: 'UPLOADS', serviceName: 'ingestor-test', assetBucket: 'wallpapers',
    }));
  });
  afterAll(async () => {
    await runtime?.dispose();
    await connection?.close();
    await container?.stop();
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
    expect(envelope).toMatchObject({ specversion: '1.0', id: occurrence.id,
      source: occurrence.source, type: 'wallpaper.uploaded', time: occurrence.occurredAt,
      correlationid: occurrence.correlationId, causationid: occurrence.causationId });
    expect(WallpaperUploadedEventSchema.parse(envelope)).toMatchObject({
      eventId: occurrence.id, wallpaper: { id: occurrence.wallpaper.id, userId: 'user_events',
        storageKey: 'wlpr_events/original.png', storageBucket: 'wallpapers' },
    });
  });
  it('reports permanent encoding failures and missing broker storage as technical failures', async () => {
    const events = await runtime.runPromise(UploadEvents);
    const invalid = { ...occurrence, wallpaper: { ...occurrence.wallpaper,
      metadata: { ...occurrence.wallpaper.metadata, width: 0 } } };
    expect(await Effect.runPromise(events.publish(invalid).pipe(Effect.flip)))
      .toMatchObject({ _tag: 'IngestionUnavailable', operation: 'encode-upload-event' });
    const manager = await connection.jetstreamManager();
    await manager.streams.delete('UPLOADS');
    expect(await runtime.runPromise(UploadEventsHealth.use((health) => health.check()))).toBe(false);
    expect(await Effect.runPromise(events.publish(occurrence).pipe(Effect.flip)))
      .toMatchObject({ _tag: 'IngestionUnavailable', operation: 'publish-upload-event' });
  });
});
