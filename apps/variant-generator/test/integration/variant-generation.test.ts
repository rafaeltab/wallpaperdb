import { GetObjectCommand } from '@aws-sdk/client-s3';
import { WallpaperVariantUploadedEventSchema } from '@wallpaperdb/events/schemas';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessVariantGeneratorTesterBuilder } from '../builders/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessVariantGeneratorTesterBuilder)
  .build();
const tester = new Tester()
  .withS3()
  .withS3Bucket('wallpapers')
  .withNats((builder) => builder.withJetstream())
  .withStream('WALLPAPER')
  .withInProcessApp();
beforeAll(() => tester.setup(), 120000);
afterAll(() => tester.destroy());

describe('variant generation composition', () => {
  it('consumes an upload, stores encoded variants, and replays without duplicate output events', async () => {
    const wallpaperId = 'wlpr_composition';
    const storageKey = `${wallpaperId}/original.png`;
    const original = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: { r: 100, g: 150, b: 200 } },
    }).png().toBuffer();
    await tester.s3.uploadObject('wallpapers', storageKey, original);
    const timestamp = '2026-09-24T00:00:00.000Z';
    const event = {
      eventId: 'composition-upload-1',
      eventType: 'wallpaper.uploaded',
      timestamp,
      wallpaper: {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: original.length,
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        storageKey,
        storageBucket: 'wallpapers',
        originalFilename: 'test.png',
        uploadedAt: timestamp,
      },
    };
    const js = await tester.nats.getJsClient();
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await js.publish('wallpaper.uploaded', JSON.stringify(event));
    const consumer = await js.consumers.get('WALLPAPER', {
      filterSubjects: 'wallpaper.variant.uploaded',
    });
    const widths: number[] = [];
    for (let index = 0; index < 4; index++) {
      const message = await consumer.next({ expires: 10000 });
      if (!message) throw new Error('Variant event was not published before the deadline');
      const publication = WallpaperVariantUploadedEventSchema.parse(message.json());
      expect(publication.timestamp).toBe(timestamp);
      expect(publication.variant.createdAt).toBe(timestamp);
      expect(publication.variant.wallpaperId).toBe(wallpaperId);
      expect(message.headers?.get('ce-specversion')).toBe('1.0');
      expect(message.headers?.get('ce-id')).toBe(publication.eventId);
      const stored = await tester.s3.getS3Client().send(new GetObjectCommand({
        Bucket: publication.variant.storageBucket,
        Key: publication.variant.storageKey,
      }));
      if (!stored.Body) throw new Error('Published variant object has no body');
      const bytes = await stored.Body.transformToByteArray();
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe('png');
      expect(bytes.byteLength).toBe(publication.variant.fileSizeBytes);
      expect(metadata.width).toBeLessThanOrEqual(publication.variant.width);
      expect(metadata.height).toBeLessThanOrEqual(publication.variant.height);
      if (publication.variant.width === 1600) {
        expect(metadata.width).toBe(1600);
        expect(metadata.height).toBe(900);
      }
      widths.push(publication.variant.width);
    }
    expect(widths).toEqual([1600, 1280, 854, 640]);
    await js.publish('wallpaper.uploaded', JSON.stringify(event));
    await expect.poll(async () => {
      const info = await manager.consumers.info('WALLPAPER', 'variant-generator-wallpaper-uploaded-consumer');
      return info.ack_floor.consumer_seq;
    }, { timeout: 15000 }).toBe(2);
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(6);
    const health = await tester.getApp().inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'healthy' });
    const ready = await tester.getApp().inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ready: true });
  });
});
