import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BaseTesterBuilder, type AddMethodsType } from '../framework.js';

/**
 * Options for creating test images
 */
export interface TestImageOptions {
  /** Image width in pixels (default: 1920) */
  width?: number;
  /** Image height in pixels (default: 1080) */
  height?: number;
  /** Image format (default: 'jpeg') */
  format?: 'jpeg' | 'png' | 'webp';
  /** Background color (default: {r: 100, g: 150, b: 200}) */
  background?: { r: number; g: number; b: number };
}

/**
 * FixturesTesterBuilder provides general test data generation utilities.
 * This builder has no infrastructure dependencies and can be used in any test.
 *
 * Features:
 * - Image generation (JPEG, PNG, WebP) using Sharp
 * - Predefined test images (validJpeg, tooSmall, etc.)
 * - Video stub generation
 * - Content hash generation (SHA256)
 * - Test ID and filename generation
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(FixturesTesterBuilder)
 *   .build();
 *
 * const image = await tester.fixtures.createTestImage({ width: 1920, height: 1080 });
 * const jpeg = await tester.fixtures.images.validJpeg();
 * const userId = tester.fixtures.generateTestUserId();
 * const hash = await tester.fixtures.generateContentHash(buffer);
 * ```
 */
export class FixturesTesterBuilder extends BaseTesterBuilder<'fixtures', []> {
  name = 'fixtures' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      /**
       * Test fixture utilities for generating test data
       */
      readonly fixtures = {
        /**
         * Generate a test image buffer using Sharp.
         * Creates a solid color image with the specified dimensions and format.
         *
         * @param options - Image generation options
         * @returns Promise resolving to image buffer
         *
         * @example
         * ```typescript
         * const image = await tester.fixtures.createTestImage({
         *   width: 1920,
         *   height: 1080,
         *   format: 'jpeg',
         *   background: { r: 255, g: 0, b: 0 } // Red
         * });
         * ```
         */
        createTestImage: async (options?: TestImageOptions): Promise<Buffer> => {
          const {
            width = 1920,
            height = 1080,
            format = 'jpeg',
            background = { r: 100, g: 150, b: 200 },
          } = options ?? {};

          let image = sharp({
            create: { width, height, channels: 3, background },
          });

          switch (format) {
            case 'jpeg':
              image = image.jpeg({ quality: 90 });
              break;
            case 'png':
              image = image.png();
              break;
            case 'webp':
              image = image.webp({ quality: 90 });
              break;
          }

          return image.toBuffer();
        },

        /**
         * Predefined test images for common scenarios.
         * All methods return Promises that resolve to image buffers.
         *
         * @example
         * ```typescript
         * const jpeg = await tester.fixtures.images.validJpeg();
         * const smallImage = await tester.fixtures.images.tooSmall();
         * ```
         */
        images: {
          /** Valid 1920x1080 JPEG image */
          validJpeg: async () =>
            this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'jpeg' }),

          /** Valid 1920x1080 PNG image */
          validPng: async () =>
            this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'png' }),

          /** Valid 1920x1080 WebP image */
          validWebp: async () =>
            this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'webp' }),

          /** Image that's too small (800x600) */
          tooSmall: async () =>
            this.fixtures.createTestImage({ width: 800, height: 600, format: 'jpeg' }),

          /** Image that's too large (8192x8192) */
          tooLarge: async () =>
            this.fixtures.createTestImage({ width: 8192, height: 8192, format: 'jpeg' }),

          /** Portrait orientation (1080x1920) */
          portrait: async () =>
            this.fixtures.createTestImage({ width: 1080, height: 1920, format: 'jpeg' }),

          /** Landscape orientation (2560x1440) */
          landscape: async () =>
            this.fixtures.createTestImage({ width: 2560, height: 1440, format: 'jpeg' }),

          /** Square aspect ratio (1920x1920) */
          square: async () =>
            this.fixtures.createTestImage({ width: 1920, height: 1920, format: 'jpeg' }),
        },

        /**
         * Create a minimal valid MP4 video stub.
         * This is just a header for testing video upload handling.
         *
         * @returns Buffer containing minimal MP4 header
         *
         * @example
         * ```typescript
         * const video = tester.fixtures.createTestVideo();
         * ```
         */
        createTestVideo: (): Buffer => {
          // Minimal valid MP4 header
          // ftyp box (file type box) - required for MP4
          return Buffer.from([
            0x00,
            0x00,
            0x00,
            0x20,
            0x66,
            0x74,
            0x79,
            0x70, // ftyp box header
            0x69,
            0x73,
            0x6f,
            0x6d,
            0x00,
            0x00,
            0x02,
            0x00, // isom major brand
            0x69,
            0x73,
            0x6f,
            0x6d,
            0x69,
            0x73,
            0x6f,
            0x32, // compatible brands
            0x61,
            0x76,
            0x63,
            0x31,
            0x6d,
            0x70,
            0x34,
            0x31, // more brands
          ]);
        },

        /**
         * Generate SHA256 content hash of a buffer.
         * This matches the hash algorithm used in the application for deduplication.
         *
         * @param buffer - Data to hash
         * @returns Promise resolving to hex-encoded hash string
         *
         * @example
         * ```typescript
         * const image = await tester.fixtures.images.validJpeg();
         * const hash = await tester.fixtures.generateContentHash(image);
         * console.log(hash); // → "a1b2c3d4..."
         * ```
         */
        generateContentHash: async (buffer: Buffer): Promise<string> => {
          const hash = createHash('sha256');
          hash.update(buffer);
          return hash.digest('hex');
        },

        /**
         * Generate a unique test user ID.
         * Format: `user_<timestamp>_<random>`
         *
         * @returns Unique user ID string
         *
         * @example
         * ```typescript
         * const userId = tester.fixtures.generateTestUserId();
         * console.log(userId); // → "user_1234567890_abc123xyz"
         * ```
         */
        generateTestUserId: (): string => {
          return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        },

        /**
         * Generate a unique test filename with timestamp.
         * Format: `test_<timestamp>.<extension>`
         *
         * @param extension - File extension (e.g., 'jpg', 'png')
         * @returns Timestamped filename
         *
         * @example
         * ```typescript
         * const filename = tester.fixtures.generateTestFilename('jpg');
         * console.log(filename); // → "test_1234567890.jpg"
         * ```
         */
        generateTestFilename: (extension: string): string => {
          return `test_${Date.now()}.${extension}`;
        },
      };
    };
  }
}
