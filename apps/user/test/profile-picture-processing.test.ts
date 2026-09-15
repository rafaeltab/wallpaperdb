import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processProfilePicture } from '../src/services/profile-picture-processing.js';

const limits = { maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 };

describe('Profile picture processing', () => {
  it('rejects oversized encoded pictures before decoding', async () => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } }).png().toBuffer();
    await expect(processProfilePicture(input, { ...limits, maxBytes: input.length - 1 })).rejects.toThrow('Picture exceeds the upload byte limit');
  });

  it('reports malformed or truncated picture bytes as validation failures', async () => {
    const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } }).jpeg().toBuffer();
    for (const input of [jpeg.subarray(0, 40), Buffer.from([0xff, 0xd8, 0xff, 0x00])]) {
      await expect(processProfilePicture(input, limits)).rejects.toThrow('Picture could not be decoded');
    }
  });

  it.each(['webp', 'png'])('rejects animated %s instead of silently selecting its first frame', async (format) => {
    // Two one-pixel frames with distinct colors.
    const gif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
    const input = format === 'webp' ? await sharp(gif, { animated: true }).webp().toBuffer()
      : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAA1JREFUeJxj+M/A8B8ABQAB/4mZPR0AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEACgAAwQzaBAAAABFmZEFUAAAAAnicY2Bg+P8fAAMCAf/1e6XXAAAAAElFTkSuQmCC', 'base64');
    if (format === 'webp') expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(processProfilePicture(input, limits)).rejects.toThrow('Animated pictures are not accepted');
  });

  it.each(['svg', 'tiff'])('rejects unsupported %s pictures', async (format) => {
    const input = format === 'svg' ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>')
      : await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } }).tiff().toBuffer();
    await expect(processProfilePicture(input, limits)).rejects.toThrow('Only JPEG, PNG, and WebP pictures are accepted');
  });

  it.each([
    ['pixel', { ...limits, maxPixels: 5 }],
    ['decoded byte', { ...limits, maxDecodedBytes: 17 }],
  ] as const)('rejects pictures exceeding the configured %s limit', async (_name, configuredLimits) => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } }).png().toBuffer();
    await expect(processProfilePicture(input, configuredLimits)).rejects.toThrow(/limit/);
  });

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
