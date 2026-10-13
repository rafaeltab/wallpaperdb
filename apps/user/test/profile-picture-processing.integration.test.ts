import sharp from 'sharp';
import { readFileSync } from 'node:fs';
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
  encoding: { staticQuality: 85, animationQuality: 85 },
};

const limits = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDecodedBytes: 64 * 1024 * 1024,
};

describe('Profile picture processing', () => {
  it.each([
    { chunk: 'VP8X', offset: 0, bit: 1 },
    { chunk: 'VP8X', offset: 0, bit: 64 },
    { chunk: 'VP8X', offset: 0, bit: 128 },
    { chunk: 'VP8X', offset: 1, bit: 255 },
    { chunk: 'VP8X', offset: 2, bit: 255 },
    { chunk: 'VP8X', offset: 3, bit: 255 },
    { chunk: 'ALPH', offset: 0, bit: 64 },
    { chunk: 'ALPH', offset: 0, bit: 128 },
    { chunk: 'ANMF', offset: 15, bit: 4 },
    { chunk: 'ANMF', offset: 15, bit: 128 },
  ])('normalizes reader-ignored $chunk fields at $offset with bit $bit', async ({
    chunk,
    offset,
    bit,
  }) => {
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const source =
      chunk === 'ANMF'
        ? (
            await processProfilePicture(
              readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url)),
              limits,
              animatedPolicy
            )
          ).bytes
        : await sharp({
            create: {
              width: 512,
              height: 512,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 0.5 },
            },
          })
            .webp()
            .toBuffer();
    const expected = await sharp(source, { animated: true }).metadata();
    const input = Buffer.from(source);
    let position = 12;
    while (input.toString('ascii', position, position + 4) !== chunk) {
      const size = input.readUInt32LE(position + 4);
      position += 8 + size + (size % 2);
      expect(position).toBeLessThan(input.length);
    }
    input[position + 8 + offset] |= bit;
    const result = await processProfilePicture(input, limits, animatedPolicy);
    const metadata = await sharp(result.bytes, { animated: true }).metadata();
    expect(metadata.width).toEqual(expected.width);
    expect(metadata.height).toEqual(expected.height);
    expect(metadata.hasAlpha).toEqual(expected.hasAlpha);
    expect(metadata.pages).toEqual(expected.pages);
    expect(metadata.delay).toEqual(expected.delay);
    expect(metadata.loop).toEqual(expected.loop);
    expect(result.bytes.equals(input)).toBe(false);
    for (let pos = 12; pos < result.bytes.length; ) {
      const type = result.bytes.toString('ascii', pos, pos + 4);
      if (type === 'VP8X') {
        expect(result.bytes[pos + 8] & 0xc1).toBe(0);
        expect([...result.bytes.subarray(pos + 9, pos + 12)]).toEqual([0, 0, 0]);
      }
      if (type === 'ALPH') expect(result.bytes[pos + 8] & 0xc0).toBe(0);
      if (type === 'ANMF') expect(result.bytes[pos + 23] & 0xfc).toBe(0);
      const size = result.bytes.readUInt32LE(pos + 4);
      pos += 8 + size + (size % 2);
    }
  });
  it.each([
    'repeated top-level',
    'distinct top-level',
    'distinct frame',
  ])('normalizes %s WebP chunks within a constrained child heap', async (placement) => {
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const canonical =
      placement === 'distinct frame'
        ? (
            await processProfilePicture(
              readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url)),
              limits,
              animatedPolicy
            )
          ).bytes
        : await sharp({ create: { width: 512, height: 512, channels: 3, background: '#ffffff' } })
            .webp()
            .toBuffer();
    const expected = await sharp(canonical, { animated: true }).metadata();
    const privateChunks = Buffer.alloc(600_000 * 8);
    for (let i = 0; i < 600_000; i++) {
      privateChunks[i * 8] = 122;
      for (let digit = 0; digit < 3; digit++)
        privateChunks[i * 8 + 1 + digit] =
          placement === 'repeated top-level' ? 65 : 33 + (Math.floor(i / 90 ** digit) % 90);
    }
    let input: Buffer;
    if (placement === 'distinct frame') {
      let offset = 12;
      while (canonical.toString('ascii', offset, offset + 4) !== 'ANMF') {
        const size = canonical.readUInt32LE(offset + 4);
        offset += 8 + size + (size % 2);
      }
      const size = canonical.readUInt32LE(offset + 4);
      const end = offset + 8 + size;
      input = Buffer.concat([canonical.subarray(0, end), privateChunks, canonical.subarray(end)]);
      input.writeUInt32LE(size + privateChunks.length, offset + 4);
    } else input = Buffer.concat([canonical, privateChunks]);
    input.writeUInt32LE(input.length - 8, 4);
    expect(input.length).toBeLessThan(limits.maxBytes);
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=96');
    try {
      const result = await processProfilePicture(input, limits, animatedPolicy);
      const metadata = await sharp(result.bytes, { animated: true }).metadata();
      expect(metadata).toMatchObject({
        width: expected.width,
        height: expected.height,
      });
      expect(metadata.pages).toEqual(expected.pages);
      expect(metadata.delay).toEqual(expected.delay);
      expect(metadata.loop).toEqual(expected.loop);
      expect(result.bytes.length).toBeLessThan(privateChunks.length);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([1, 2])('normalizes a still WebP with %s ignored ANIM chunks', async (count) => {
    const source = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.5 },
      },
    })
      .webp({ lossless: true })
      .toBuffer();
    const images: Buffer[] = [];
    for (let offset = 12; offset < source.length; ) {
      const size = source.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (['VP8 ', 'VP8L', 'ALPH'].includes(source.toString('ascii', offset, offset + 4)))
        images.push(source.subarray(offset, end));
      offset = end;
    }
    const header = Buffer.alloc(30);
    header.write('RIFF');
    header.write('WEBP', 8);
    header.write('VP8X', 12);
    header.writeUInt32LE(10, 16);
    header[20] = 0x10;
    header.writeUIntLE(511, 24, 3);
    header.writeUIntLE(511, 27, 3);
    const controls = Buffer.from('414e494d06000000000000000000', 'hex');
    const tagged = Buffer.concat([header, ...images, controls, ...(count === 2 ? [controls] : [])]);
    tagged.writeUInt32LE(tagged.length - 8, 4);
    expect((await sharp(tagged).metadata()).hasAlpha).toBe(true);
    const picture = await processProfilePicture(tagged, limits);
    expect(picture.bytes.includes(Buffer.from('ANIM'))).toBe(false);
    const raw = await sharp(picture.bytes).ensureAlpha().raw().toBuffer();
    expect([...raw.subarray(0, 4)]).toEqual([255, 255, 255, 128]);
  });
  it('preserves fragmented GIF loop controls and image data during direct normalization', async () => {
    const input = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30' +
        '010101020100002c0000000001000100000201440101003b',
      'hex'
    );
    const picture = await processProfilePicture(input, limits, {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif'],
      animation: { available: true },
    });
    expect(picture.bytes.includes(Buffer.from('ANIM'))).toBe(true);
    expect(await sharp(picture.bytes, { animated: true }).metadata()).toMatchObject({ loop: 3 });
  });
  it.each([
    'comment',
    'application',
  ])('processes fragmented GIF %s metadata within a constrained child heap', async (extension) => {
    const payload = Buffer.alloc(4 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 2) {
      payload[i] = 1;
      payload[i + 1] = 65;
    }
    const input = Buffer.concat([
      Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
      extension === 'comment'
        ? Buffer.from([0x21, 0xfe])
        : Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from('PRIVATEAPP1')]),
      payload,
      Buffer.from('002c00000000010001000002024401003b', 'hex'),
    ]);
    expect(input.length).toBeLessThan(limits.maxBytes);
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=96');
    try {
      const result = await processProfilePicture(input, limits, {
        ...policy,
        acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif'],
        animation: { available: true },
      });
      expect(await sharp(result.bytes).metadata()).toMatchObject({
        format: 'webp',
        width: 512,
        height: 512,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([
    0, 49, 1, 113, 255,
  ])('handles the declared pixel aspect ratio %s in direct GIF normalization', async (aspect) => {
    const bytes = Buffer.from(
      '47494638396101000100800000000000ffffff2c00000000010001000002024401003b',
      'hex'
    );
    bytes[12] = aspect;
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const process = processProfilePicture(bytes, limits, animatedPolicy);
    if (aspect === 0 || aspect === 49) expect((await process).mimeType).toBe('image/webp');
    else await expect(process).rejects.toThrow('pixel aspect ratio');
  });
  it('normalizes repeated unknown top-level chunks in static and animated WebP', async () => {
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const gif = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
    const inputs = [
      await sharp({ create: { width: 512, height: 512, channels: 3, background: '#7799aa' } })
        .webp()
        .toBuffer(),
      (await processProfilePicture(gif, limits, animatedPolicy)).bytes,
    ];
    const privateChunk = Buffer.from('50524956080000005052495641544521', 'hex');
    for (const canonical of inputs) {
      const tagged = Buffer.concat([canonical, privateChunk, privateChunk]);
      tagged.writeUInt32LE(tagged.length - 8, 4);
      await sharp(tagged, { animated: true }).raw().toBuffer();
      const expected = await sharp(canonical, { animated: true }).metadata();
      const result = await processProfilePicture(tagged, limits, animatedPolicy);
      expect(result.bytes.includes(Buffer.from('PRIVATE!'))).toBe(false);
      const actual = await sharp(result.bytes, { animated: true }).metadata();
      expect(actual).toMatchObject({
        width: expected.width,
        height: expected.height,
      });
      expect(actual.pages).toBe(expected.pages);
      expect(actual.delay).toEqual(expected.delay);
      expect(actual.loop).toBe(expected.loop);
    }
  });
  it('normalizes valid unknown chunks inside animated WebP frames', async () => {
    const input = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const canonical = (await processProfilePicture(input, limits, animatedPolicy)).bytes;
    let offset = 12;
    while (canonical.toString('ascii', offset, offset + 4) !== 'ANMF') {
      const size = canonical.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    const frameSize = canonical.readUInt32LE(offset + 4);
    const payload = Buffer.from('PRIVATE-FRAME-META');
    const extension = Buffer.alloc(8 + payload.length + (payload.length % 2));
    extension.write('TEST');
    extension.writeUInt32LE(payload.length, 4);
    payload.copy(extension, 8);
    const end = offset + 8 + frameSize;
    const tagged = Buffer.concat([canonical.subarray(0, end), extension, canonical.subarray(end)]);
    tagged.writeUInt32LE(frameSize + extension.length, offset + 4);
    tagged.writeUInt32LE(tagged.length - 8, 4);
    await sharp(tagged, { animated: true }).raw().toBuffer();
    const expected = await sharp(canonical, { animated: true }).metadata();
    const picture = await processProfilePicture(tagged, limits, animatedPolicy);
    expect(picture.bytes.includes(payload)).toBe(false);
    expect(await sharp(picture.bytes, { animated: true }).metadata()).toMatchObject({
      width: expected.width,
      height: expected.height,
      pages: expected.pages,
      pageHeight: expected.pageHeight,
      delay: expected.delay,
      loop: expected.loop,
      hasAlpha: expected.hasAlpha,
    });
  });
  it('rejects a tiny GIF with excessive output-frame work before it can reach per-frame encoding', async () => {
    const input = Buffer.concat([
      Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
      ...Array.from({ length: 1024 }, () => Buffer.from('2c0000000001000100000202440100', 'hex')),
      Buffer.from([0x3b]),
    ]);
    expect(input.length).toBeLessThan(limits.maxBytes);
    expect(await sharp(input, { animated: true }).metadata()).toMatchObject({
      width: 1,
      pageHeight: 1,
      pages: 1024,
    });
    await expect(
      processProfilePicture(input, limits, {
        ...policy,
        acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif'],
        animation: { available: true },
      })
    ).rejects.toThrow('Picture exceeds the decoded byte limit');
  });
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
        bytes.writeUIntLE(256, offsets[1] + 8, 3);
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
    const single = Buffer.from(
      '47494638396101000100800000000000ffffff2c00000000010001000002024401003b',
      'hex'
    );
    const still = await processProfilePicture(single, limits, animatedPolicy);
    expect((await sharp(still.bytes).metadata()).pages).toBeUndefined();
  });

  it('independently decodes the compressed GIF contract fixture into its intended pixels', async () => {
    const gif = readFileSync(new URL('./fixtures/profile-compressed.gif', import.meta.url));
    const { data, info } = await sharp(gif, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 128, height: 192, channels: 4 });
    expect(
      [0, 1, 2].map((frame) =>
        [16, 96].map((x) => [
          ...data.subarray(
            ((frame * 64 + 32) * 128 + x) * 4,
            ((frame * 64 + 32) * 128 + x) * 4 + 4
          ),
        ])
      )
    ).toEqual([
      [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ],
      [
        [0, 255, 0, 255],
        [255, 255, 0, 255],
      ],
      [
        [255, 255, 255, 255],
        [255, 0, 255, 255],
      ],
    ]);
  });

  it('preserves disposal and alpha in direct GIF normalization and validates GIF controls and bounds', async () => {
    const gif = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const picture = await processProfilePicture(gif, limits, animatedPolicy);
    const { data } = await sharp(picture.bytes, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const samples = [0, 1, 2, 3].map((frame) => [
      ...data.subarray(
        ((frame * 512 + 256) * 512 + 32) * 4,
        ((frame * 512 + 256) * 512 + 32) * 4 + 4
      ),
    ]);
    for (const [frame, expected] of [
      [0, [255, 0, 0, 255]],
      [1, [0, 255, 0, 255]],
      [2, [255, 255, 255, 255]],
      [3, [0, 0, 0, 0]],
    ] as const) {
      expect(samples[frame][3]).toBe(expected[3]);
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(samples[frame][channel] - expected[channel])).toBeLessThan(15);
    }
    const interlaced = readFileSync(new URL('./fixtures/profile-interlaced.gif', import.meta.url));
    expect([...(await sharp(interlaced).ensureAlpha().raw().toBuffer())]).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    const image = gif.indexOf(Buffer.from('2c0000000040008000', 'hex'));
    expect(image).toBeGreaterThan(0);
    const invalidBounds = Buffer.from(gif);
    invalidBounds.writeUInt16LE(224, image + 1);
    await expect(processProfilePicture(invalidBounds, limits, animatedPolicy)).rejects.toThrow(
      'GIF structure'
    );
    const invalidLoop = Buffer.from(gif);
    invalidLoop.writeUInt16LE(65535, 53);
    await expect(processProfilePicture(invalidLoop, limits, animatedPolicy)).rejects.toThrow(/GIF/);
  });

  it('fully decodes later canonical frames and rejects invalid padding or unsupported animated orientation', async () => {
    const animatedPolicy = {
      ...policy,
      acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif' as const],
      animation: { available: true },
    };
    const gif = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
    const canonical = (await processProfilePicture(gif, limits, animatedPolicy)).bytes;
    const offsets: number[] = [];
    for (let offset = 12; offset < canonical.length; ) {
      if (canonical.toString('ascii', offset, offset + 4) === 'ANMF') offsets.push(offset);
      const size = canonical.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    const corrupt = Buffer.from(canonical);
    const last = offsets.at(-1);
    if (last === undefined) throw new Error('Missing frame');
    for (let offset = last + 24; offset < corrupt.length; ) {
      const size = corrupt.readUInt32LE(offset + 4);
      if (corrupt.toString('ascii', offset, offset + 4) === 'VP8 ')
        corrupt.fill(255, offset + 18, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    await expect(processProfilePicture(corrupt, limits, animatedPolicy)).rejects.toThrow(
      'Picture could not be decoded'
    );
    const badPadding = Buffer.concat([canonical, Buffer.from('4f444420010000002101', 'hex')]);
    badPadding.writeUInt32LE(badPadding.length - 8, 4);
    await expect(processProfilePicture(badPadding, limits, animatedPolicy)).rejects.toThrow(
      'Picture could not be decoded'
    );
    const oriented = await sharp(gif, { animated: true })
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();
    await expect(processProfilePicture(oriented, limits, animatedPolicy)).rejects.toThrow(
      /orientation/
    );
  });
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
      'Only JPEG, PNG, WebP, and GIF pictures are accepted'
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
  it.each([
    'static',
    'animated',
  ])('kills and reaps its native encoder before interrupted %s work completes', async (source) => {
    const input =
      source === 'animated'
        ? readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url))
        : await sharp({
            create: { width: 4000, height: 4000, channels: 3, background: '#3578aa' },
          })
            .png()
            .toBuffer();
    const abort = new AbortController();
    const spawn = vi.spyOn(childProcess, 'spawn');
    syncBuiltinESMExports();
    const running = Effect.runPromise(
      Effect.flatMap(PictureCodec, (codec) =>
        codec.process(input, {
          ...policy,
          acceptedSourceFormats: [...policy.acceptedSourceFormats, 'image/gif'],
          animation: { available: true },
        })
      ).pipe(Effect.provide(pictureCodecLayer(limits))),
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
