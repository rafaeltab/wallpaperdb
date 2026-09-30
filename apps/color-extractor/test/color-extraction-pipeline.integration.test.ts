import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessColorExtractorTesterBuilder } from './builders/index.js';
import { WallpaperColorsExtractedCloudEventSchema } from '@wallpaperdb/events';
import { createHash } from 'node:crypto';

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
  width: number;
  height: number;
  fileSizeBytes: number;
  fileType?: 'image' | 'video';
}) {
  return {
    specversion: '1.0',
    source: 'https://wallpaperdb/ingestor',
    id: 'pipeline-upload',
    type: 'wallpaper.uploaded',
    time: '2026-09-24T10:00:00.000Z',
    datacontenttype: 'application/json',
    data: {
      wallpaper: {
        id: overrides.wallpaperId,
        userId: 'user_test',
        fileType: overrides.fileType ?? ('image' as const),
        mimeType: 'image/png',
        fileSizeBytes: overrides.fileSizeBytes,
        width: overrides.width,
        height: overrides.height,
        aspectRatio: overrides.width / overrides.height,
        asset: { owner: 'ingestor', id: overrides.wallpaperId },
        uploadedAt: '2026-09-24T10:00:00.000Z',
      },
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

      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();

    await tester.setup();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  it('should extract colors and publish wallpaper.colors.extracted event for an uploaded image', async () => {
    const wallpaperId = 'wlpr_pipeline';
    const storageKey = `${wallpaperId}/original.png`;
    const imageBuffer = await createTestImage(100, 100, { r: 255, g: 0, b: 0 });
    await tester.s3.uploadObject('wallpapers', storageKey, imageBuffer);

    const event = createWallpaperUploadedEvent({
      wallpaperId,
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
    const envelope = WallpaperColorsExtractedCloudEventSchema.parse(
      JSON.parse(new TextDecoder().decode(msg.data))
    );
    expect(envelope.specversion).toBe('1.0');
    expect(envelope.causationid).toBe(event.id);
    expect(envelope.causationsource).toBe(event.source);
    const data = envelope.data;
    expect(data.wallpaperId).toBe(wallpaperId);
    expect(data.original).toEqual({ owner: 'ingestor', id: wallpaperId });
    expect(data.provenance.originalSha256).toBe(
      createHash('sha256').update(imageBuffer).digest('hex')
    );
    expect(data.measurements.sampleCount).toBe(16384);
    expect(data.measurements.layers).toHaveLength(5);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'color-extractor-wallpaper-uploaded-consumer'))
            .num_ack_pending
      )
      .toBe(0);
  });
});
