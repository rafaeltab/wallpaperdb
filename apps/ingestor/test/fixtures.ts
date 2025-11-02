import sharp from 'sharp';
import crypto from 'node:crypto';

/**
 * Generate a test image using Sharp
 */
export async function createTestImage(options: {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  color?: { r: number; g: number; b: number };
}): Promise<Buffer> {
  const { width, height, format, color = { r: 128, g: 128, b: 128 } } = options;

  // Create a solid color image
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  });

  // Convert to the requested format
  switch (format) {
    case 'jpeg':
      return image.jpeg().toBuffer();
    case 'png':
      return image.png().toBuffer();
    case 'webp':
      return image.webp().toBuffer();
  }
}

/**
 * Create a test video buffer (fake MP4)
 * Note: This is not a real video, just for testing file type detection
 */
export function createTestVideo(): Buffer {
  // MP4 file signature
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ftyp box
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  ]);
  // Add some padding
  return Buffer.concat([mp4Header, Buffer.alloc(1024)]);
}

/**
 * Generate content hash for a buffer (SHA256)
 */
export function generateContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Test wallpaper fixtures
 */
export const TEST_IMAGES = {
  validJpeg: async () =>
    createTestImage({ width: 1920, height: 1080, format: 'jpeg' }),
  validPng: async () =>
    createTestImage({ width: 1920, height: 1080, format: 'png' }),
  validWebp: async () =>
    createTestImage({ width: 1920, height: 1080, format: 'webp' }),
  tooSmall: async () =>
    createTestImage({ width: 800, height: 600, format: 'jpeg' }),
  tooLarge: async () =>
    createTestImage({ width: 8000, height: 5000, format: 'jpeg' }),
  largeFile: async () => {
    // Create a large image (simulating > 50MB would be slow, so we'll mock this in tests)
    return createTestImage({
      width: 1920,
      height: 1080,
      format: 'png',
      color: { r: 255, g: 0, b: 0 },
    });
  },
  duplicate: async () =>
    createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 100, g: 100, b: 100 },
    }),
};

/**
 * Mock invalid file (not an image)
 */
export const INVALID_FILE = Buffer.from('This is not an image file');

/**
 * Generate a random user ID for testing
 */
export function generateTestUserId(): string {
  return `user_test_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Generate a test filename
 */
export function generateTestFilename(extension = 'jpg'): string {
  return `test-wallpaper-${Date.now()}.${extension}`;
}
