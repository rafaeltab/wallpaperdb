import {
  WallpaperVariantAvailableEventSchema,
  type WallpaperUploadedEvent,
} from '@wallpaperdb/events/schemas';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
  PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import { eq } from 'drizzle-orm';
import { headers as natsHeaders } from 'nats';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { wallpapers } from '../../src/db/schema.js';
import { InProcessMediaTesterBuilder, MediaMigrationsTesterBuilder } from '../builders/index.js';

describe('Media Service - Event Consumption', () => {
  const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(S3TesterBuilder)
      .with(NatsTesterBuilder)
      .with(MediaMigrationsTesterBuilder)
      .with(InProcessMediaTesterBuilder)
      .build();

    const tester = new TesterClass();

    tester
      .withPostgres((builder) => builder.withDatabase(`test_media_events_${Date.now()}`))
      .withS3()
      .withS3Bucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withMigrations()
      .withInProcessApp();

    return tester;
  };

  let tester: ReturnType<typeof setup>;

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  async function waitForAccepted(sequence: number) {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await vi.waitFor(
      async () => {
        const info = await manager.consumers.info('WALLPAPER', 'media-wallpaper-uploaded-consumer');
        expect(info.ack_floor.stream_seq).toBeGreaterThanOrEqual(sequence);
      },
      { timeout: 10000, interval: 25 }
    );
  }

  async function observeAvailable(wallpaperId: string) {
    const connection = await tester.nats.getConnection();
    const subscription = connection.subscribe('wallpaper.variant.available', { timeout: 10000 });
    const result = (async () => {
      for await (const message of subscription) {
        const event = WallpaperVariantAvailableEventSchema.parse(
          JSON.parse(new TextDecoder().decode(message.data))
        );
        if (event.variant.wallpaperId === wallpaperId) return event;
      }
      throw new Error('Availability subscription closed before matching output');
    })();
    // Attach a handler immediately while publication is in flight.
    void result.catch(() => undefined);
    await connection.flush();
    return { result, close: () => subscription.unsubscribe() };
  }

  it('should consume wallpaper.uploaded event and send wallpaper.variant.available event', async () => {
    const js = await tester.nats.getJsClient();

    const event: WallpaperUploadedEvent = {
      eventId: 'evt_test_001',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_test_001',
        userId: 'user_test_001',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024000,
        width: 1920,
        height: 1080,
        aspectRatio: 1.777,
        storageKey: 'wlpr_test_001/original.jpg',
        storageBucket: 'wallpapers',
        originalFilename: 'test-image.jpg',
        uploadedAt: new Date().toISOString(),
      },
    };

    const observation = await observeAvailable('wlpr_test_001');

    // Publish event to NATS
    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event));

    // Wait for event to be processed (with timeout)
    await waitForAccepted(accepted.seq);

    // Verify database contains the wallpaper
    const db = tester.getFixtureDatabase();
    const [result] = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_test_001'));

    expect(result).toBeDefined();
    expect(result.id).toBe('wlpr_test_001');

    try {
      const res = await observation.result;
      expect(res.variant).toEqual({
        wallpaperId: 'wlpr_test_001',
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        format: 'image/jpeg',
        fileSizeBytes: 1024000,
        createdAt: event.wallpaper.uploadedAt,
      });
    } finally {
      observation.close();
    }
  });

  it('should consume wallpaper.uploaded event and store in database', async () => {
    const js = await tester.nats.getJsClient();

    const event: WallpaperUploadedEvent = {
      eventId: 'evt_store_001',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_store_001',
        userId: 'user_test_001',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024000,
        width: 1920,
        height: 1080,
        aspectRatio: 1.777,
        storageKey: 'wlpr_store_001/original.jpg',
        storageBucket: 'wallpapers',
        originalFilename: 'test-image.jpg',
        uploadedAt: new Date().toISOString(),
      },
    };

    // Publish event to NATS
    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event));

    // Wait for event to be processed (with timeout)
    await waitForAccepted(accepted.seq);

    // Verify database contains the wallpaper
    const db = tester.getFixtureDatabase();
    const [result] = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_store_001'));

    expect(result).toBeDefined();
    expect(result.id).toBe('wlpr_store_001');
    expect(result.storageKey).toBe('wlpr_store_001/original.jpg');
    expect(result.storageBucket).toBe('wallpapers');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fileSizeBytes).toBe(1024000);
    expect(result.createdAt).toBeDefined();
  });

  it('should handle duplicate events idempotently', async () => {
    const js = await tester.nats.getJsClient();

    const event: WallpaperUploadedEvent = {
      eventId: 'evt_test_002',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_test_002',
        userId: 'user_test_002',
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: 2048000,
        width: 2560,
        height: 1440,
        aspectRatio: 1.777,
        storageKey: 'wlpr_test_002/original.png',
        storageBucket: 'wallpapers',
        originalFilename: 'test-image.png',
        uploadedAt: new Date().toISOString(),
      },
    };

    // Wait for the second delivery's acknowledgement, not merely the first insert.
    await js.publish('wallpaper.uploaded', JSON.stringify(event));
    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event));

    // Wait for both events to be processed
    await waitForAccepted(accepted.seq);

    // Verify only one record exists
    const db = tester.getFixtureDatabase();
    const results = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_test_002'));

    expect(results).toHaveLength(1);
    expect(results[0].width).toBe(2560);
    expect(results[0].height).toBe(1440);
  });

  it('quarantines malformed input before acknowledgement and keeps the service healthy', async () => {
    const js = await tester.nats.getJsClient();

    const malformedEvent = {
      eventId: 'evt_test_003',
      eventType: 'wallpaper.uploaded',
      wallpaper: { id: 'wlpr_malformed' },
      // Missing timestamp and required wallpaper metadata
    };

    // Publish malformed event
    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(malformedEvent));

    // Wait for processing
    await waitForAccepted(accepted.seq);

    // Service should still be healthy (no crash)
    const app = tester.getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const quarantined = await manager.streams.getMessage('MEDIA_QUARANTINE', {
      last_by_subj: 'media.quarantine',
    });
    expect(JSON.parse(new TextDecoder().decode(quarantined.data))).toEqual(malformedEvent);
    expect(quarantined.header.get('ce-reason')).toBe('Invalid');
    expect(quarantined.header.get('ce-originalsubject')).toBe('wallpaper.uploaded');
    const db = tester.getFixtureDatabase();
    expect(await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_malformed'))).toEqual(
      []
    );
  });

  it('projects WebP upload metadata when the publisher includes tracing headers', async () => {
    const js = await tester.nats.getJsClient();

    const event: WallpaperUploadedEvent = {
      eventId: 'evt_test_004',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_test_004',
        userId: 'user_test_004',
        fileType: 'image',
        mimeType: 'image/webp',
        fileSizeBytes: 512000,
        width: 1280,
        height: 720,
        aspectRatio: 1.777,
        storageKey: 'wlpr_test_004/original.webp',
        storageBucket: 'wallpapers',
        originalFilename: 'test-image.webp',
        uploadedAt: new Date().toISOString(),
      },
    };

    // Publish with trace headers
    const headers = natsHeaders();
    headers.set('traceparent', '00-11111111111111111111111111111111-2222222222222222-01');

    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event), {
      headers,
    });

    // Wait for processing
    await waitForAccepted(accepted.seq);

    // Verify event was processed
    const db = tester.getFixtureDatabase();
    const [result] = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_test_004'));

    expect(result).toBeDefined();
    expect(result.mimeType).toBe('image/webp');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('should retrieve wallpaper via GET endpoint after event is processed', async () => {
    const js = await tester.nats.getJsClient();

    // Opaque fixture bytes are returned unchanged by the original-image endpoint.
    const imageBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);

    // Upload the image to S3 first (simulating what ingestor does)
    const storageKey = 'wlpr_test_005/original.jpg';
    await tester.s3.uploadObject('wallpapers', storageKey, imageBuffer);

    // Publish wallpaper.uploaded event
    const event: WallpaperUploadedEvent = {
      eventId: 'evt_test_005',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_test_005',
        userId: 'user_test_005',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: imageBuffer.length,
        width: 1920,
        height: 1080,
        aspectRatio: 1.777,
        storageKey: storageKey,
        storageBucket: 'wallpapers',
        originalFilename: 'test-image.jpg',
        uploadedAt: new Date().toISOString(),
      },
    };

    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event));

    // Wait for event processing
    await waitForAccepted(accepted.seq);

    // Verify database has the record
    const db = tester.getFixtureDatabase();
    const [dbResult] = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_test_005'));

    expect(dbResult).toBeDefined();

    // Now test the GET endpoint
    const app = tester.getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/wallpapers/wlpr_test_005',
    });

    // Verify successful retrieval
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cache-control']).toContain('max-age');

    // Verify the body is the image data
    const responseBuffer = response.rawPayload;
    expect(responseBuffer).toBeDefined();
    expect(responseBuffer.length).toBeGreaterThan(0);
    expect(responseBuffer).toEqual(imageBuffer);
  });

  it('should return 404 when wallpaper exists in DB but file missing from S3', async () => {
    const js = await tester.nats.getJsClient();

    // Publish event for a wallpaper (but DON'T upload to S3)
    const event: WallpaperUploadedEvent = {
      eventId: 'evt_test_006',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_test_006',
        userId: 'user_test_006',
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: 1024,
        width: 800,
        height: 600,
        aspectRatio: 1.333,
        storageKey: 'wlpr_test_006/original.png',
        storageBucket: 'wallpapers',
        originalFilename: 'missing.png',
        uploadedAt: new Date().toISOString(),
      },
    };

    const accepted = await js.publish('wallpaper.uploaded', JSON.stringify(event));

    // Wait for event processing
    await waitForAccepted(accepted.seq);

    // Verify database has the record
    const db = tester.getFixtureDatabase();
    const [dbResult] = await db.select().from(wallpapers).where(eq(wallpapers.id, 'wlpr_test_006'));

    expect(dbResult).toBeDefined();

    // Try to GET the wallpaper (should fail - file not in S3)
    const app = tester.getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/wallpapers/wlpr_test_006',
    });

    // Should return 404
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = JSON.parse(response.body);
    expect(body.type).toBeDefined();
    expect(body.title).toBeDefined();
    expect(body.status).toBe(404);
    expect(body.detail).toContain('not found');
  });

  it('should return 404 when wallpaper does not exist in database', async () => {
    const app = tester.getApp();

    const response = await app.inject({
      method: 'GET',
      url: '/wallpapers/wlpr_nonexistent',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = JSON.parse(response.body);
    expect(body.type).toBeDefined();
    expect(body.title).toBeDefined();
    expect(body.status).toBe(404);
  });
});
