import sharp from 'sharp';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
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
  encoding: { staticQuality: 85 },
};

const limits = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDecodedBytes: 64 * 1024 * 1024,
};

describe('Profile picture processing', () => {
  it.each([
    'old',
    'new',
  ])('rejects the real Apple %s gain-map JPEG instead of storing only its SDR base', async (generation) => {
    const input = await readFile(
      new URL(`./fixtures/profile-picture-hdr/apple_gainmap_${generation}.jpg`, import.meta.url)
    );
    expect(await sharp(input).metadata()).toMatchObject({
      format: 'jpeg',
      space: 'srgb',
      depth: 'uchar',
    });
    await sharp(input, { failOn: 'warning' }).raw().toBuffer();
    await expect(processProfilePicture(input, limits)).rejects.toThrow(
      'Picture color interpretation is unsupported'
    );
  });
  it.each([
    [
      'Ultra HDR',
      0xe1,
      Buffer.from(
        'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/></rdf:RDF></x:xmpmeta>'
      ),
    ],
    [
      'ISO gain-map',
      0xe2,
      Buffer.concat([Buffer.from('urn:iso:std:iso:ts:21496:-1\0'), Buffer.alloc(4)]),
    ],
  ] as const)('rejects JPEGs declaring %s before the SDR decoder discards that declaration', async (_format, marker, payload) => {
    const jpeg = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .jpeg()
      .toBuffer();
    const header = Buffer.from([0xff, marker, 0, 0]);
    header.writeUInt16BE(payload.length + 2, 2);
    const input = Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
    expect(await sharp(input).metadata()).toMatchObject({
      format: 'jpeg',
      space: 'srgb',
      depth: 'uchar',
    });
    await sharp(input, { failOn: 'warning' }).raw().toBuffer();
    await expect(processProfilePicture(input, limits)).rejects.toThrow(
      'Picture color interpretation is unsupported'
    );
  });
  it.each([
    'EXIF',
    'XMP',
  ])('normalizes SDR JPEG %s containing gain-map text without a gain-map declaration', async (metadataType) => {
    const source = sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    });
    const namespace = 'http://ns.adobe.com/hdr-gain-map/1.0/';
    let input: Buffer;
    if (metadataType === 'EXIF') {
      input = await source
        .withExifMerge({ IFD0: { Model: namespace } })
        .jpeg()
        .toBuffer();
    } else {
      const jpeg = await source.jpeg({ progressive: true }).toBuffer();
      const payload = Buffer.from(
        `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${namespace}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`
      );
      const header = Buffer.from([0xff, 0xe1, 0, 0]);
      header.writeUInt16BE(payload.length + 2, 2);
      input = Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
    }
    expect(input.includes(Buffer.from(namespace))).toBe(true);
    const picture = await processProfilePicture(input, limits);
    expect(await sharp(picture.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 512,
      height: 512,
      space: 'srgb',
      depth: 'uchar',
    });
    expect((await sharp(picture.bytes).metadata()).xmp).toBeUndefined();
    expect((await sharp(picture.bytes).metadata()).exif).toBeUndefined();
    expect(picture.bytes.includes(Buffer.from(namespace))).toBe(false);
  });
  it.each([
    ['PQ', '0000000463494350091000014d2323fe'],
    ['HLG', '0000000463494350091200014ea7f790'],
  ])('rejects %s HDR PNG16 despite the native decoder reporting ordinary RGB16', async (_transfer, chunk) => {
    const png = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#3578aa' },
    })
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    // Valid cICP chunks use the PQ/HLG declarations from the PNG specification.
    // https://www.w3.org/TR/png-3/#cICP-chunk
    const input = Buffer.concat([png.subarray(0, 33), Buffer.from(chunk, 'hex'), png.subarray(33)]);
    expect(await sharp(input).metadata()).toMatchObject({ space: 'rgb16', depth: 'ushort' });
    expect(await sharp(input).raw().toBuffer()).toHaveLength(3 * 2 * 3);
    await expect(processProfilePicture(input, limits)).rejects.toThrow(
      'Picture color interpretation is unsupported'
    );
  });
  it('normalizes ordinary SDR PNG16 without confusing sample depth with HDR', async () => {
    const input = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 53, g: 120, b: 170, alpha: 0.25 },
      },
    })
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    expect(await sharp(input).metadata()).toMatchObject({ space: 'rgb16', depth: 'ushort' });
    const picture = await processProfilePicture(input, limits);
    expect(await sharp(picture.bytes).metadata()).toMatchObject({
      width: 512,
      height: 512,
      space: 'srgb',
      depth: 'uchar',
      hasAlpha: true,
    });
    const pixel = await sharp(picture.bytes)
      .extract({ left: 256, top: 256, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(pixel[3]).toBe(64);
  });
  it('rejects an alpha chunk after the image even when the native decoder accepts the image', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3578aa' },
    })
      .webp()
      .toBuffer();
    const extension = Buffer.alloc(18);
    extension.write('VP8X');
    extension.writeUInt32LE(10, 4);
    extension.writeUIntLE(511, 12, 3);
    extension.writeUIntLE(511, 15, 3);
    const malformed = Buffer.concat([
      webp.subarray(0, 12),
      extension,
      webp.subarray(12),
      Buffer.from('414c5048010000000000', 'hex'),
    ]);
    malformed.writeUInt32LE(malformed.length - 8, 4);
    expect(await sharp(malformed).raw().toBuffer()).toHaveLength(512 * 512 * 3);
    await expect(processProfilePicture(malformed, limits)).rejects.toThrow(
      'Picture could not be decoded'
    );
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
  it('rejects an extended header that omits alpha present in the lossless image', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#3578aa80' },
    })
      .webp({ lossless: true })
      .toBuffer();
    expect(webp.toString('ascii', 12, 16)).toBe('VP8L');
    const extension = Buffer.alloc(18);
    extension.write('VP8X');
    extension.writeUInt32LE(10, 4);
    extension.writeUIntLE(511, 12, 3);
    extension.writeUIntLE(511, 15, 3);
    const malformed = Buffer.concat([webp.subarray(0, 12), extension, webp.subarray(12)]);
    malformed.writeUInt32LE(malformed.length - 8, 4);
    await expect(processProfilePicture(malformed, limits)).rejects.toThrow(
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
  it('allows canonical output larger than the source decoded-byte budget when it fits output policy', async () => {
    const pixels = Buffer.alloc(16 * 16 * 3);
    let seed = 123456;
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const input = await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } })
      .png()
      .toBuffer();
    const picture = await processProfilePicture(input, {
      ...limits,
      maxDecodedBytes: pixels.length,
    });
    expect(picture.bytes.length).toBeGreaterThan(pixels.length * 2 + 4096);
    expect(picture.bytes.length).toBeLessThan(policy.maxOutputBytes);
    expect(await sharp(picture.bytes).metadata()).toMatchObject({ width: 512, height: 512 });
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
  it.each([
    false,
    true,
  ])('preserves exact canonical static WebP bytes after fully decoding them with lossless=%s', async (lossless) => {
    const input = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#3578aa80' },
    })
      .webp({ quality: 73, lossless })
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
