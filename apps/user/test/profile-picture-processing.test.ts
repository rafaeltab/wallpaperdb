import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processProfilePicture } from '../src/services/profile-picture-processing.js';

const limits = { maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 };

describe('Profile picture processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('decodes %s and emits normalized WebP without source metadata', async (format) => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } })
      .withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const picture = await processProfilePicture(input, limits);
    const metadata = await sharp(picture.bytes).metadata();
    expect(picture).toMatchObject({ mimeType: 'image/webp', width: 2, height: 3 });
    expect(metadata).toMatchObject({ format: 'webp', width: 2, height: 3 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(await sharp(picture.bytes).raw().toBuffer()).toHaveLength(2 * 3 * 3);
  });
});
