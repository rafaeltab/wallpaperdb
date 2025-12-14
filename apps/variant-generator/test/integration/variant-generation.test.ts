import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { container } from 'tsyringe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResolutionMatcherService } from '../../src/services/resolution-matcher.service.js';
import { VariantGeneratorService } from '../../src/services/variant-generator.service.js';
import { InProcessVariantGeneratorTesterBuilder } from '../builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessVariantGeneratorTesterBuilder)
  .build();

describe('Variant Generator Service', () => {
  let tester: InstanceType<typeof TesterClass>;
  let app: FastifyInstance;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();

    await tester.setup();
    app = tester.getApp();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  describe('Health Checks', () => {
    it('should return healthy status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
    });

    it('should return ready status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ready).toBe(true);
    });
  });

  describe('Resolution Matcher Service', () => {
    let resolutionMatcher: ResolutionMatcherService;

    beforeAll(() => {
      resolutionMatcher = container.resolve(ResolutionMatcherService);
    });

    describe('Aspect Ratio Matching', () => {
      it('should match 16:9 (standard) aspect ratio', () => {
        // 3840x2160 = 1.777... (16:9)
        const category = resolutionMatcher.matchAspectRatioCategory(3840, 2160);
        expect(category).toBe('standard');
      });

      it('should match 16:10 as standard (within tolerance)', () => {
        // 1920x1200 = 1.6 (16:10)
        const category = resolutionMatcher.matchAspectRatioCategory(1920, 1200);
        expect(category).toBe('standard');
      });

      it('should match 21:9 (ultrawide) aspect ratio', () => {
        // 3440x1440 = 2.388... (roughly 21:9)
        const category = resolutionMatcher.matchAspectRatioCategory(3440, 1440);
        expect(category).toBe('ultrawide');
      });

      it('should match 9:16 (phone) aspect ratio', () => {
        // 1080x1920 = 0.5625 (9:16)
        const category = resolutionMatcher.matchAspectRatioCategory(1080, 1920);
        expect(category).toBe('phone');
      });

      it('should match 9:19.5 as phone (within tolerance)', () => {
        // 1080x2340 ≈ 0.46 (9:19.5 - modern phone)
        const category = resolutionMatcher.matchAspectRatioCategory(1080, 2340);
        expect(category).toBe('phone');
      });

      it('should return null for non-standard aspect ratios', () => {
        // 1:1 square
        const category = resolutionMatcher.matchAspectRatioCategory(1000, 1000);
        expect(category).toBeNull();
      });
    });

    describe('Applicable Presets', () => {
      it('should return standard presets for 4K (3840x2160)', () => {
        const presets = resolutionMatcher.getApplicablePresets(3840, 2160);

        // Should return all standard presets except 4K (which is same size)
        expect(presets.length).toBe(6); // 2K, 1080p, 900p, 720p, 480p, 360p
        expect(presets.map((p) => p.label)).toContain('2K/1440p');
        expect(presets.map((p) => p.label)).toContain('1080p');
        expect(presets.map((p) => p.label)).not.toContain('4K'); // Same size, excluded
      });

      it('should return only smaller presets for 1080p source', () => {
        const presets = resolutionMatcher.getApplicablePresets(1920, 1080);

        // Should only return presets smaller than 1080p
        expect(presets.length).toBe(4); // 900p, 720p, 480p, 360p
        expect(presets.map((p) => p.label)).not.toContain('4K');
        expect(presets.map((p) => p.label)).not.toContain('2K/1440p');
        expect(presets.map((p) => p.label)).not.toContain('1080p'); // Same size
      });

      it('should return empty array for small images', () => {
        // 640x360 is the smallest standard preset
        const presets = resolutionMatcher.getApplicablePresets(640, 360);
        expect(presets.length).toBe(0);
      });

      it('should return ultrawide presets for UWQHD (3440x1440)', () => {
        const presets = resolutionMatcher.getApplicablePresets(3440, 1440);

        // Should return UWFHD only (smaller than UWQHD)
        expect(presets.length).toBe(1);
        expect(presets[0].label).toBe('UWFHD');
      });

      it('should return phone presets for FHD+ phone (1080x2400)', () => {
        const presets = resolutionMatcher.getApplicablePresets(1080, 2400);

        // Should return smaller phone presets (FHD Phone excluded because width matches exactly)
        expect(presets.length).toBe(2); // HD Phone, SD Phone
        expect(presets.map((p) => p.label)).toContain('HD Phone');
        expect(presets.map((p) => p.label)).toContain('SD Phone');
      });

      it('should return empty array for non-matching aspect ratios', () => {
        // 1:1 square - no matching category
        const presets = resolutionMatcher.getApplicablePresets(2000, 2000);
        expect(presets.length).toBe(0);
      });
    });
  });

  describe('Variant Generation', () => {
    /**
     * Helper function to create a test image with Sharp
     */
    async function createTestImage(
      width: number,
      height: number,
      format: 'jpeg' | 'png' | 'webp' = 'jpeg'
    ): Promise<Buffer> {
      return await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 100, g: 150, b: 200 },
        },
      })
        .toFormat(format)
        .toBuffer();
    }

    it('should generate variants for a 4K standard image', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_4k_${Date.now()}`;

      // Create and upload original image
      const original = await createTestImage(3840, 2160, 'jpeg');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

      // Generate variants
      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/jpeg',
        fileSizeBytes: original.length,
        width: 3840,
        height: 2160,
        aspectRatio: 3840 / 2160,
        storageKey: `${wallpaperId}/original.jpg`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.jpg',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // Should generate 6 variants (all standard presets smaller than 4K)
      expect(variants.length).toBe(6);

      // Verify each variant was uploaded and has correct metadata
      for (const variant of variants) {
        expect(variant.wallpaperId).toBe(wallpaperId);
        expect(variant.format).toBe('image/jpeg');
        expect(variant.fileSizeBytes).toBeGreaterThan(0);
        expect(variant.storageKey).toContain(wallpaperId);
        expect(variant.storageBucket).toBe('wallpapers');

        // Verify file exists in MinIO
        const exists = await tester.minio.objectExists('wallpapers', variant.storageKey);
        expect(exists).toBe(true);
      }
    });

    it('should preserve PNG format for PNG originals', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_png_${Date.now()}`;

      // Create and upload PNG original
      const original = await createTestImage(1920, 1080, 'png');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.png`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/png',
        fileSizeBytes: original.length,
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        storageKey: `${wallpaperId}/original.png`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.png',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // Should generate 4 variants (900p, 720p, 480p, 360p)
      expect(variants.length).toBe(4);

      // All variants should be PNG
      for (const variant of variants) {
        expect(variant.format).toBe('image/png');
        expect(variant.storageKey).toMatch(/\.png$/);
      }
    });

    it('should preserve WebP format for WebP originals', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_webp_${Date.now()}`;

      // Create and upload WebP original
      const original = await createTestImage(1920, 1080, 'webp');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.webp`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/webp',
        fileSizeBytes: original.length,
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        storageKey: `${wallpaperId}/original.webp`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.webp',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // All variants should be WebP
      for (const variant of variants) {
        expect(variant.format).toBe('image/webp');
        expect(variant.storageKey).toMatch(/\.webp$/);
      }
    });

    it('should skip videos', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);

      const wallpaperData = {
        id: 'wlpr_video_test',
        userId: 'user_test',
        fileType: 'video' as const,
        mimeType: 'video/mp4',
        fileSizeBytes: 1000000,
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        storageKey: 'wlpr_video_test/original.mp4',
        storageBucket: 'wallpapers',
        originalFilename: 'test.mp4',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);
      expect(variants.length).toBe(0);
    });

    it('should skip non-matching aspect ratios', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_square_${Date.now()}`;

      // Create square image (1:1 aspect ratio - no matching category)
      const original = await createTestImage(2000, 2000, 'jpeg');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/jpeg',
        fileSizeBytes: original.length,
        width: 2000,
        height: 2000,
        aspectRatio: 1.0,
        storageKey: `${wallpaperId}/original.jpg`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.jpg',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);
      expect(variants.length).toBe(0);
    });

    it('should generate correct dimensions for variants', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_dims_${Date.now()}`;

      // Create 4K image
      const original = await createTestImage(3840, 2160, 'jpeg');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/jpeg',
        fileSizeBytes: original.length,
        width: 3840,
        height: 2160,
        aspectRatio: 3840 / 2160,
        storageKey: `${wallpaperId}/original.jpg`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.jpg',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // Verify expected dimensions
      const expectedDimensions = [
        { width: 2560, height: 1440 }, // 2K
        { width: 1920, height: 1080 }, // 1080p
        { width: 1600, height: 900 }, // 900p
        { width: 1280, height: 720 }, // 720p
        { width: 854, height: 480 }, // 480p
        { width: 640, height: 360 }, // 360p
      ];

      for (const expected of expectedDimensions) {
        const variant = variants.find((v) => v.width === expected.width);
        expect(variant).toBeDefined();
        expect(variant?.height).toBe(expected.height);
      }
    });

    it('should generate ultrawide variants', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_uw_${Date.now()}`;

      // Create UWQHD image (3440x1440)
      const original = await createTestImage(3440, 1440, 'jpeg');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/jpeg',
        fileSizeBytes: original.length,
        width: 3440,
        height: 1440,
        aspectRatio: 3440 / 1440,
        storageKey: `${wallpaperId}/original.jpg`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.jpg',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // Should generate 1 variant (UWFHD - 2560x1080)
      expect(variants.length).toBe(1);
      expect(variants[0].width).toBe(2560);
      expect(variants[0].height).toBe(1080);
    });

    it('should generate phone variants', async () => {
      const variantGenerator = container.resolve(VariantGeneratorService);
      const wallpaperId = `wlpr_test_phone_${Date.now()}`;

      // Create FHD+ phone image (1080x2400)
      const original = await createTestImage(1080, 2400, 'jpeg');
      await tester.minio.uploadObject('wallpapers', `${wallpaperId}/original.jpg`, original);

      const wallpaperData = {
        id: wallpaperId,
        userId: 'user_test',
        fileType: 'image' as const,
        mimeType: 'image/jpeg',
        fileSizeBytes: original.length,
        width: 1080,
        height: 2400,
        aspectRatio: 1080 / 2400,
        storageKey: `${wallpaperId}/original.jpg`,
        storageBucket: 'wallpapers',
        originalFilename: 'test.jpg',
        uploadedAt: new Date().toISOString(),
      };

      const variants = await variantGenerator.generateVariants(wallpaperData);

      // Should generate 2 variants (HD Phone 720x1280, SD Phone 480x854)
      // FHD Phone (1080x1920) is excluded because width 1080 is not < original width 1080
      expect(variants.length).toBe(2);

      // Verify phone dimensions (portrait orientation)
      const widths = variants.map((v) => v.width);
      expect(widths).toContain(720);
      expect(widths).toContain(480);
    });
  });
});
