import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessColorExtractorTesterBuilder } from './builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessColorExtractorTesterBuilder)
  .build();

async function createTestImage(
  width: number,
  height: number,
  options?: { r?: number; g?: number; b?: number }
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
      .withS3()
      .withS3Bucket('wallpapers')
      .withS3Bucket('asset-references')
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
    await tester.s3.uploadObject('wallpapers', storageKey, imageBuffer);

    const event = createWallpaperUploadedEvent({
      wallpaperId,
      storageKey,
      width: 100,
      height: 100,
      fileSizeBytes: imageBuffer.length,
    });

    const js = await tester.nats.getJsClient();

    await js.publish('wallpaper.uploaded', JSON.stringify(event));

    const consumer = await js.consumers.get('WALLPAPER', {
      filterSubjects: 'wallpaper.colors.extracted',
    });
    const msg = await consumer.next({ expires: 5000 });

    expect(msg).toBeDefined();
    if (!msg) throw new Error('No extracted event');
    const envelope = JSON.parse(new TextDecoder().decode(msg.data));
    expect(envelope.specversion).toBe('1.0');
    const data = envelope.data;
    expect(data.wallpaperId).toBe(wallpaperId);
    expect(data.colorHistogram).toHaveLength(64);
    expect(data.colorSpace).toBe('hsv');
    expect(data.colorHistogram.reduce((sum: number, v: number) => sum + v, 0)).toBeCloseTo(1.0, 3);

    const redBin = 0 * 4 + 1 * 2 + 1;
    expect(data.colorHistogram[redBin]).toBeCloseTo(1.0, 3);
  });
});
