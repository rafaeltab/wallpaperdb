import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { pictureCodecLayer } from '../src/adapters/pictures/index.js';
import {
  PictureCodec,
  type PictureLimits,
  type EffectivePicturePolicy,
} from '../src/capabilities/pictures/index.js';

async function processProfilePicture(
  bytes: Buffer,
  limits: PictureLimits,
  effectivePolicy = policy
) {
  const outcome = await Effect.runPromise(
    Effect.flatMap(PictureCodec, (codec) => codec.process(bytes, effectivePolicy)).pipe(
      Effect.provide(pictureCodecLayer(limits))
    )
  );
  if (outcome._tag === 'Rejected') throw new Error(outcome.message);
  return outcome.picture;
}

const policy: EffectivePicturePolicy = {
  output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
  maxOutputBytes: 5242880,
  acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp'],
  animation: { available: false },
  encoding: { staticQuality: 85, animationQuality: 85 },
};

const limits = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDecodedBytes: 64 * 1024 * 1024,
};

describe('Profile picture processing', () => {
  it('normalizes direct GIF and WebP without losing frames, alpha, timing or looping', async () => {
    const gif = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030102000021f904010a0000002c000000000100010000020244010021f90401140000002c00000000010001000002024c01003b',
      'hex'
    );
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    for (const input of [
      gif,
      await sharp(gif, { animated: true }).webp({ lossless: true }).toBuffer(),
    ]) {
      const picture = await processProfilePicture(input, limits, animatedPolicy);
      const metadata = await sharp(picture.bytes, { animated: true }).metadata();
      expect(metadata).toMatchObject({
        width: 512,
        height: 1024,
        pageHeight: 512,
        pages: 2,
        loop: 3,
        delay: [100, 200],
        space: 'srgb',
        hasAlpha: true,
      });
      expect(metadata.icc).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      const { data, info } = await sharp(picture.bytes, { animated: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 512, height: 1024, channels: 4 });
      expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
      expect([...data.subarray(512 * 512 * 4, 512 * 512 * 4 + 4)]).toEqual([255, 255, 255, 255]);
      expect((await processProfilePicture(picture.bytes, limits, animatedPolicy)).bytes).toEqual(
        picture.bytes
      );
    }
  });
  it('validates every animated frame before passthrough and enforces aggregate decoded bounds', async () => {
    const gif = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const canonical = (await processProfilePicture(gif, limits, animatedPolicy)).bytes;
    const offsets: number[] = [];
    for (let offset = 12; offset < canonical.length; ) {
      if (canonical.toString('ascii', offset, offset + 4) === 'ANMF') offsets.push(offset);
      const size = canonical.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    expect(offsets).toHaveLength(4);
    for (const mutate of [
      (bytes: Buffer) => {
        bytes[20] |= 0x80;
      },
      (bytes: Buffer) => {
        bytes.writeUIntLE(256, offsets[1] + 8, 3);
      },
      (bytes: Buffer) => {
        bytes[offsets[1] + 23] |= 0x80;
      },
      (bytes: Buffer) => {
        bytes.writeUInt32LE(0xffffffff, offsets[1] + 28);
      },
      (bytes: Buffer) => {
        bytes.writeUIntLE(510, offsets[1] + 14, 3);
      },
    ]) {
      const malformed = Buffer.from(canonical);
      mutate(malformed);
      await expect(processProfilePicture(malformed, limits, animatedPolicy)).rejects.toThrow(
        'Picture could not be decoded'
      );
    }
    await expect(
      processProfilePicture(
        canonical,
        { ...limits, maxDecodedBytes: 512 * 512 * 4 * 4 - 1 },
        animatedPolicy
      )
    ).rejects.toThrow('decoded byte limit');
    await expect(
      processProfilePicture(canonical, { ...limits, maxPixels: 512 * 512 - 1 }, animatedPolicy)
    ).rejects.toThrow('pixel limit');
    // Unknown/private chunks never pass through, and zero delays follow browser playback.
    const privateChunk = Buffer.from('50524956080000005052495641544521', 'hex');
    const tagged = Buffer.concat([canonical, privateChunk]);
    tagged.writeUInt32LE(tagged.length - 8, 4);
    tagged.writeUIntLE(0, offsets[0] + 20, 3);
    const normalized = await processProfilePicture(tagged, limits, animatedPolicy);
    expect(normalized.bytes.includes(Buffer.from('PRIVATE!'))).toBe(false);
    expect(await sharp(normalized.bytes, { animated: true }).metadata()).toMatchObject({
      pages: 4,
      loop: 3,
      delay: [100, 200, 300, 400],
    });
    await expect(
      processProfilePicture(canonical, limits, {
        ...animatedPolicy,
        maxOutputBytes: canonical.length - 1,
      })
    ).rejects.toThrow('processed output byte limit');
  });
  it('keeps single-frame GIF static and normalizes default or tiny GIF frame delays', async () => {
    const gif = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f90400000000002c000000000100010000020244010021f90400010000002c00000000010001000002024c01003b',
      'hex'
    );
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const picture = await processProfilePicture(gif, limits, animatedPolicy);
    expect(await sharp(picture.bytes, { animated: true }).metadata()).toMatchObject({
      pages: 2,
      loop: 0,
      delay: [100, 100],
    });
    const single = await sharp(gif).gif().toBuffer();
    const still = await processProfilePicture(single, limits, animatedPolicy);
    expect((await sharp(still.bytes).metadata()).pages).toBeUndefined();
  });
  it('rejects a canonical-sized WebP containing duplicate image chunks', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3578aa' },
    })
      .webp()
      .toBuffer();
    const duplicate = Buffer.concat([webp, webp.subarray(12)]);
    duplicate.writeUInt32LE(duplicate.length - 8, 4);
    await expect(processProfilePicture(duplicate, limits)).rejects.toThrow(
      'Picture could not be decoded'
    );
  });
  it('applies source orientation before producing canonical pixels and strips camera metadata', async () => {
    const pixels = Buffer.alloc(40 * 20 * 3);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 40; x++) pixels[(y * 40 + x) * 3 + (x < 20 ? 0 : 2)] = 255;
    const input = await sharp(pixels, { raw: { width: 40, height: 20, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Make: 'PRIVATE_CAMERA', Model: 'PRIVATE_MODEL' } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(input.includes(Buffer.from('PRIVATE_CAMERA'))).toBe(true);
    const picture = await processProfilePicture(input, limits);
    const top = await sharp(picture.bytes)
      .extract({ left: 256, top: 100, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const bottom = await sharp(picture.bytes)
      .extract({ left: 256, top: 400, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(top[0]).toBeGreaterThan(240);
    expect(top[2]).toBeLessThan(15);
    expect(bottom[2]).toBeGreaterThan(240);
    expect(bottom[0]).toBeLessThan(15);
    expect(picture.bytes.includes(Buffer.from('PRIVATE_CAMERA'))).toBe(false);
    expect((await sharp(picture.bytes).metadata()).exif).toBeUndefined();
  });
  it('preserves transparency while normalizing PNG and profiled WebP into metadata-free sRGB', async () => {
    for (const format of ['png', 'webp'] as const) {
      const input = await sharp({
        create: {
          width: 20,
          height: 10,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 0.25 },
        },
      })
        .withIccProfile('p3')
        .toFormat(format)
        .toBuffer();
      const source = await sharp(input).metadata();
      expect(source.icc).toBeDefined();
      const picture = await processProfilePicture(input, limits);
      const metadata = await sharp(picture.bytes).metadata();
      expect(metadata).toMatchObject({ width: 512, height: 512, space: 'srgb', hasAlpha: true });
      expect(metadata.icc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      const pixel = await sharp(picture.bytes)
        .extract({ left: 200, top: 200, width: 1, height: 1 })
        .raw()
        .toBuffer();
      expect(pixel[0]).toBeLessThan(25);
      expect(pixel[1]).toBeGreaterThan(240);
      expect(pixel[2]).toBeLessThan(25);
      expect(pixel[3]).toBe(64);
    }
  });
  it('enforces final encoded bytes independently of the source upload limit', async () => {
    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .png()
      .toBuffer();
    await expect(
      processProfilePicture(input, limits, { ...policy, maxOutputBytes: 1 })
    ).rejects.toThrow('processed output byte limit');
    const canonical = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3578aa' },
    })
      .webp()
      .toBuffer();
    await expect(
      processProfilePicture(canonical, limits, { ...policy, maxOutputBytes: 1 })
    ).rejects.toThrow('processed output byte limit');
  });
  it('rejects malformed WebP containers even when their first image can be decoded', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3578aa' },
    })
      .webp()
      .toBuffer();
    await expect(
      processProfilePicture(Buffer.concat([webp, Buffer.from('hidden trailing bytes')]), limits)
    ).rejects.toThrow('Picture could not be decoded');
  });
  it('preserves exact canonical static WebP bytes after fully decoding them', async () => {
    const input = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#3578aa80' },
    })
      .webp({ quality: 73 })
      .toBuffer();
    const picture = await processProfilePicture(input, limits);
    expect(picture.bytes).toEqual(input);
    expect(picture).toMatchObject({ width: 512, height: 512 });
  });
  it('rejects oversized encoded pictures before decoding', async () => {
    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .png()
      .toBuffer();
    await expect(
      processProfilePicture(input, { ...limits, maxBytes: input.length - 1 })
    ).rejects.toThrow('Picture exceeds the upload byte limit');
  });

  it('reports malformed or truncated picture bytes as validation failures', async () => {
    const jpeg = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .jpeg()
      .toBuffer();
    for (const input of [jpeg.subarray(0, 40), Buffer.from([0xff, 0xd8, 0xff, 0x00])]) {
      await expect(processProfilePicture(input, limits)).rejects.toThrow(
        'Picture could not be decoded'
      );
    }
  });

  it.each([
    'webp',
    'png',
  ])('rejects animated %s instead of silently selecting its first frame', async (format) => {
    // Two one-pixel frames with distinct colors.
    const gif = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
      'hex'
    );
    const input =
      format === 'webp'
        ? await sharp(gif, { animated: true }).webp().toBuffer()
        : Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAA1JREFUeJxj+M/A8B8ABQAB/4mZPR0AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEACgAAwQzaBAAAABFmZEFUAAAAAnicY2Bg+P8fAAMCAf/1e6XXAAAAAElFTkSuQmCC',
            'base64'
          );
    if (format === 'webp') expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(processProfilePicture(input, limits)).rejects.toThrow(
      'Animated pictures are not accepted'
    );
  });

  it.each(['svg', 'tiff'])('rejects unsupported %s pictures', async (format) => {
    const input =
      format === 'svg'
        ? Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>'
          )
        : await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3578aa' } })
            .tiff()
            .toBuffer();
    await expect(processProfilePicture(input, limits)).rejects.toThrow(
      'Only JPEG, PNG, and WebP pictures are accepted'
    );
  });

  it.each([
    ['pixel', { ...limits, maxPixels: 5 }],
    ['decoded byte', { ...limits, maxDecodedBytes: 17 }],
  ] as const)('rejects pictures exceeding the configured %s limit', async (_name, configuredLimits) => {
    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .png()
      .toBuffer();
    await expect(processProfilePicture(input, configuredLimits)).rejects.toThrow(/limit/);
  });

  it.each([
    'jpeg',
    'png',
    'webp',
  ] as const)('decodes %s and emits normalized WebP without source metadata', async (format) => {
    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .withMetadata({ orientation: 6 })
      .toFormat(format)
      .toBuffer();
    const picture = await processProfilePicture(input, limits);
    const metadata = await sharp(picture.bytes).metadata();
    expect(picture).toMatchObject({ mimeType: 'image/webp', width: 512, height: 512 });
    expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(await sharp(picture.bytes).raw().toBuffer()).toHaveLength(512 * 512 * 3);
  });
  it('kills and reaps its native encoder before interrupted work completes', async () => {
    const input = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: '#3578aa' },
    })
      .png()
      .toBuffer();
    const abort = new AbortController();
    const spawn = vi.spyOn(childProcess, 'spawn');
    syncBuiltinESMExports();
    const running = Effect.runPromise(
      Effect.flatMap(PictureCodec, (codec) => codec.process(input, policy)).pipe(
        Effect.provide(pictureCodecLayer(limits))
      ),
      { signal: abort.signal }
    );
    const settled = running.then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    try {
      await vi.waitFor(() => expect(spawn).toHaveReturned(), { timeout: 3000, interval: 5 });
      const result = spawn.mock.results[0];
      if (!result || result.type !== 'return') throw new Error('Expected native encoder process');
      const child = result.value;
      abort.abort();
      expect(await settled).toHaveProperty('error');
      expect(child.signalCode).toBe('SIGKILL');
      const pid = child.pid;
      if (pid === undefined) throw new Error('Expected the native encoder process ID');
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      abort.abort();
      await settled;
      spawn.mockRestore();
      syncBuiltinESMExports();
    }
  });
});
