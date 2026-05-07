import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessColorExtractorTesterBuilder } from './builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessColorExtractorTesterBuilder)
  .build();

async function createTestImage(
  width: number,
  height: number,
  options?: { r?: number; g?: number; b?: number },
): Promise<Buffer> {
  const { r = 255, g = 0, b = 0 } = options ?? {};
  return sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

function createWallpaperUploadedEvent(overrides: {
  wallpaperId: string;
  storageKey: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  fileType?: 'image' | 'video';
}) {
  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    eventType: 'wallpaper.uploaded' as const,
    timestamp: new Date().toISOString(),
    wallpaper: {
      id: overrides.wallpaperId,
      userId: 'user_test',
      fileType: overrides.fileType ?? ('image' as const),
      mimeType: 'image/png',
      fileSizeBytes: overrides.fileSizeBytes,
      width: overrides.width,
      height: overrides.height,
      aspectRatio: overrides.width / overrides.height,
      storageKey: overrides.storageKey,
      storageBucket: 'wallpapers',
      originalFilename: 'test.png',
      uploadedAt: new Date().toISOString(),
    },
  };
}

describe('Color Extraction Pipeline', () => {
  let tester: InstanceType<typeof TesterClass>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();

    await tester.setup();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  it('should extract colors and publish wallpaper.colors.extracted event for an uploaded image', async () => {
    const wallpaperId = `wlpr_pipe_${Date.now()}`;
    const storageKey = `${wallpaperId}/original.png`;
    const imageBuffer = await createTestImage(100, 100, { r: 255, g: 0, b: 0 });
    await tester.minio.uploadObject('wallpapers', storageKey, imageBuffer);

    const event = createWallpaperUploadedEvent({
      wallpaperId,
      storageKey,
      width: 100,
      height: 100,
      fileSizeBytes: imageBuffer.length,
    });

    const js = await tester.nats.getJsClient();

    await js.publish('wallpaper.uploaded', JSON.stringify(event));

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const nc = await tester.nats.getConnection();
    const jsm = await nc.jetstreamManager();
    const streamInfo = await jsm.streams.info('WALLPAPER');
    const msgCount = streamInfo.state.messages;

    expect(msgCount).toBeGreaterThanOrEqual(2);

    const consumer = await js.consumers.get('WALLPAPER', {
      filter_subject: 'wallpaper.colors.extracted',
    } as any);
    const msg = await consumer.next({ expires: 5000 });

    expect(msg).toBeDefined();
    const data = JSON.parse(new TextDecoder().decode(msg!.data));
    expect(data.wallpaperId).toBe(wallpaperId);
    expect(data.colorHistogram).toHaveLength(64);
    expect(data.colorSpace).toBe('hsv');
    expect(data.colorHistogram.reduce((sum: number, v: number) => sum + v, 0)).toBeCloseTo(1.0, 3);

    const redBin = 0 * 4 + 1 * 2 + 1;
    expect(data.colorHistogram[redBin]).toBeCloseTo(1.0, 3);
  });

  it('should skip non-image events without publishing colors.extracted', async () => {
    const wallpaperId = `wlpr_video_${Date.now()}`;
    const event = createWallpaperUploadedEvent({
      wallpaperId,
      storageKey: `${wallpaperId}/original.mp4`,
      width: 1920,
      height: 1080,
      fileSizeBytes: 1000000,
      fileType: 'video',
    });

    const js = await tester.nats.getJsClient();
    await js.publish('wallpaper.uploaded', JSON.stringify(event));

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const consumer = await js.consumers.get('WALLPAPER', {
      filter_subject: 'wallpaper.colors.extracted',
    } as any);

    const msg = await consumer.next({ expires: 3000 });

    if (msg) {
      const data = JSON.parse(new TextDecoder().decode(msg.data));
      expect(data.wallpaperId).not.toBe(wallpaperId);
    }
  });
});
