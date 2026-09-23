import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { WallpaperUploadedEventSchema } from '@wallpaperdb/events/schemas';
import { ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadedEventsLayer } from '../../src/adapters/events/index.js';
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
  let runtime: ManagedRuntime.ManagedRuntime<UploadEvents, unknown>;
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
});
