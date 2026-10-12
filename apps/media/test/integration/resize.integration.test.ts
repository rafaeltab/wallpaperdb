import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
  PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { variants, wallpapers } from '../../src/db/schema.js';
import { InProcessMediaTesterBuilder, MediaMigrationsTesterBuilder } from '../builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .with(MediaMigrationsTesterBuilder)
  .with(InProcessMediaTesterBuilder)
  .build();

describe('resize composition', () => {
  let tester: InstanceType<typeof TesterClass>;
  let app: FastifyInstance;
  let db: ReturnType<InstanceType<typeof TesterClass>['getFixtureDatabase']>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withPostgres((builder) => builder.withDatabase(`test_media_resize_${Date.now()}`))
      .withS3()
      .withS3Bucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withMigrations()
      .withInProcessApp();

    await tester.setup();
    app = tester.getApp();
    db = tester.getFixtureDatabase();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  async function createTestImage(
    width: number,
    height: number,
    format: 'jpeg' | 'png' | 'webp' = 'jpeg',
    color: 'red' | 'green' | 'blue' = 'red'
  ): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background:
          color === 'red'
            ? { r: 255, g: 0, b: 0 }
            : color === 'green'
              ? { r: 0, g: 255, b: 0 }
              : { r: 0, g: 0, b: 255 },
      },
    })
      .toFormat(format)
      .toBuffer();
  }

  async function expectSourceColor(bytes: Buffer, color: 'red' | 'green') {
    const pixel = await sharp(bytes)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(Math.abs(pixel[0] - (color === 'red' ? 255 : 0))).toBeLessThanOrEqual(3);
    expect(Math.abs(pixel[1] - (color === 'green' ? 255 : 0))).toBeLessThanOrEqual(3);
    expect(pixel[2]).toBeLessThanOrEqual(2);
  }

  it('returns a successful resized response for a large image', async () => {
    const image = await createTestImage(3840, 2160, 'jpeg');
    const wallpaperId = 'wlpr_test_resize_003';

    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, image);

    await db.insert(wallpapers).values({
      id: wallpaperId,
      mimeType: 'image/jpeg',
      fileSizeBytes: image.length,
      width: 3840,
      height: 2160,
      storageKey: `${wallpaperId}/original.jpg`,
      storageBucket: 'wallpapers',
      createdAt: new Date(),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/wallpapers/${wallpaperId}?w=1920`,
    });

    expect(response.statusCode).toBe(200);
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({
      width: 1920,
      height: 1080,
      format: 'jpeg',
    });
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers['content-length']).toBeUndefined();
    const unchanged = await app.inject(`/wallpapers/${wallpaperId}`);
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.rawPayload).toEqual(image);
    expect(unchanged.headers['content-length']).toBe(String(image.length));
  });

  it('should use exact matching variant when dimensions match exactly', async () => {
    const wallpaperId = 'wlpr_variant_exact_001';

    // Create original and variants
    const original = await createTestImage(3840, 2160, 'jpeg');
    const variant1920 = await createTestImage(1920, 1080, 'jpeg', 'green');
    const variant1280 = await createTestImage(1280, 720, 'jpeg', 'blue');

    // Upload to S3
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/1920x1080.jpg`, variant1920);
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/1280x720.jpg`, variant1280);

    // Insert into DB
    await db.insert(wallpapers).values({
      id: wallpaperId,
      mimeType: 'image/jpeg',
      fileSizeBytes: original.length,
      width: 3840,
      height: 2160,
      storageKey: `${wallpaperId}/original.jpg`,
      storageBucket: 'wallpapers',
      createdAt: new Date(),
    });

    // Insert variants
    await db.insert(variants).values([
      {
        id: 'var_001',
        wallpaperId,
        storageKey: `${wallpaperId}/1920x1080.jpg`,
        width: 1920,
        height: 1080,
        fileSizeBytes: variant1920.length,
      },
      {
        id: 'var_002',
        wallpaperId,
        storageKey: `${wallpaperId}/1280x720.jpg`,
        width: 1280,
        height: 720,
        fileSizeBytes: variant1280.length,
      },
    ]);

    // Request exact match: 1920x1080
    const response = await app.inject({
      method: 'GET',
      url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
    });

    expect(response.statusCode).toBe(200);
    await expectSourceColor(response.rawPayload, 'green');

    // Should use the 1920x1080 variant (no resizing needed)
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });

  it('should use next larger variant when requested size is between variants', async () => {
    const wallpaperId = 'wlpr_variant_larger_001';

    const original = await createTestImage(3840, 2160, 'jpeg');
    const variant2560 = await createTestImage(2560, 1440, 'jpeg', 'blue');
    const variant1920 = await createTestImage(1920, 1080, 'jpeg', 'green');
    const variant1280 = await createTestImage(1280, 720, 'jpeg', 'blue');

    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/2560x1440.jpg`, variant2560);
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/1920x1080.jpg`, variant1920);
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/1280x720.jpg`, variant1280);

    await db.insert(wallpapers).values({
      id: wallpaperId,
      mimeType: 'image/jpeg',
      fileSizeBytes: original.length,
      width: 3840,
      height: 2160,
      storageKey: `${wallpaperId}/original.jpg`,
      storageBucket: 'wallpapers',
      createdAt: new Date(),
    });

    await db.insert(variants).values([
      {
        id: 'var_003',
        wallpaperId,
        storageKey: `${wallpaperId}/2560x1440.jpg`,
        width: 2560,
        height: 1440,
        fileSizeBytes: variant2560.length,
      },
      {
        id: 'var_004',
        wallpaperId,
        storageKey: `${wallpaperId}/1920x1080.jpg`,
        width: 1920,
        height: 1080,
        fileSizeBytes: variant1920.length,
      },
      {
        id: 'var_005',
        wallpaperId,
        storageKey: `${wallpaperId}/1280x720.jpg`,
        width: 1280,
        height: 720,
        fileSizeBytes: variant1280.length,
      },
    ]);

    // Request 1600x900 - should use 1920x1080 variant (next larger)
    const response = await app.inject({
      method: 'GET',
      url: `/wallpapers/${wallpaperId}?w=1600&h=900`,
    });

    expect(response.statusCode).toBe(200);
    await expectSourceColor(response.rawPayload, 'green');

    // Should resize 1920x1080 variant down to 1600x900
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(900);
  });

  it('should use original when no variants exist', async () => {
    const wallpaperId = 'wlpr_no_variants_001';

    const original = await createTestImage(3840, 2160, 'jpeg');

    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

    await db.insert(wallpapers).values({
      id: wallpaperId,
      mimeType: 'image/jpeg',
      fileSizeBytes: original.length,
      width: 3840,
      height: 2160,
      storageKey: `${wallpaperId}/original.jpg`,
      storageBucket: 'wallpapers',
      createdAt: new Date(),
    });

    // No variants inserted - should use original

    const response = await app.inject({
      method: 'GET',
      url: `/wallpapers/${wallpaperId}?w=1920`,
    });

    expect(response.statusCode).toBe(200);
    await expectSourceColor(response.rawPayload, 'red');

    // Should resize original down to 1920x1080
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });

  it('should fallback to original when variant file is missing from S3', async () => {
    const wallpaperId = 'wlpr_missing_variant_001';

    const original = await createTestImage(3840, 2160, 'jpeg');

    // Upload only original (not the variant file)
    await tester.s3.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

    await db.insert(wallpapers).values({
      id: wallpaperId,
      mimeType: 'image/jpeg',
      fileSizeBytes: original.length,
      width: 3840,
      height: 2160,
      storageKey: `${wallpaperId}/original.jpg`,
      storageBucket: 'wallpapers',
      createdAt: new Date(),
    });

    // Insert variant in DB but file doesn't exist in S3
    await db.insert(variants).values({
      id: 'var_missing',
      wallpaperId,
      storageKey: `${wallpaperId}/1920x1080.jpg`, // File doesn't exist
      width: 1920,
      height: 1080,
      fileSizeBytes: 300000,
    });

    // Request should fallback to original gracefully
    const response = await app.inject({
      method: 'GET',
      url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
    });

    expect(response.statusCode).toBe(200);
    await expectSourceColor(response.rawPayload, 'red'); // Not 404

    // Should have used original and resized it
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });
});
