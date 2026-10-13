import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePictureGif, pictureAnimationTiming, encodePictureAnimation } from '../../src/features/picture-editor';

const resolvedLimits = { maxPixels: 20_000_000, maxDecodedBytes: 80_000_000 };

describe('Picture animation', () => {
  it.each([-1, Infinity])('rejects an invalid retained-pixel reservation of %s bytes', (retainedBytes) => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex'));
    expect(() => decodePictureGif(bytes, resolvedLimits, () => retainedBytes).next()).toThrow('Unable to decode this GIF picture.');
  });
  it.each([4, 5])('charges decoded GIF indices against a %s-byte budget', (maxDecodedBytes) => {
    const bytes = Uint8Array.from(Buffer.from(
      '47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex'));
    const decode = () => Array.from(decodePictureGif(bytes, { maxPixels: 1, maxDecodedBytes }));
    if (maxDecodedBytes === 4) expect(decode).toThrow('decoded byte limit');
    else expect(decode().filter((step) => step.kind === 'frame')).toMatchObject([
      { width: 1, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) },
    ]);
  });
  it('rejects excessive loop-control data before scanning its untrusted bulk payload', () => {
    const payload = Buffer.alloc(4 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 2) {
      payload[i] = 1;
      payload[i + 1] = 65;
    }
    const input = Buffer.concat([
      Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30', 'hex'),
      payload,
      Buffer.from('002c00000000010001000002024401003b', 'hex'),
    ]);
    let checkpoints = 0;
    expect(() => {
      for (const step of decodePictureGif(input, resolvedLimits)) {
        if (step.kind === 'progress' && ++checkpoints > 4)
          throw new Error('Scanned beyond fixed-size loop control.');
      }
    }).toThrow('Unable to decode this GIF picture.');
  });

  it('preserves fragmented loop controls and image data', () => {
    const input = Buffer.from(
      '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30' +
      '010101020100002c0000000001000100000201440101003b', 'hex');
    const decoder = decodePictureGif(input, resolvedLimits);
    let step = decoder.next();
    let pixels: number[] = [];
    while (!step.done) {
      if (step.value.kind === 'frame') pixels = Array.from(step.value.pixels);
      step = decoder.next();
    }
    expect(step.value).toEqual({ loop: 3, frameCount: 1, animated: true });
    expect(pixels).toEqual([0, 0, 0, 255]);
  });
  it.each([0, 49, 1, 113, 255])('handles the declared GIF pixel aspect ratio %s', (aspect) => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex'));
    bytes[12] = aspect;
    const decode = () => Array.from(decodePictureGif(bytes, resolvedLimits));
    if (aspect === 0 || aspect === 49) expect(decode().filter((step) => step.kind === 'frame')).toHaveLength(1);
    else expect(decode).toThrow('pixel aspect ratio');
  });
  it.each([8, 9])('charges restore-previous snapshot bytes against a %s-byte budget', (maxDecodedBytes) => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff21f9040c0a0000002c00000000010001000002024401003b', 'hex'));
    const decode = () => Array.from(decodePictureGif(bytes, { maxPixels: 1, maxDecodedBytes }));
    if (maxDecodedBytes === 8) expect(decode).toThrow('decoded byte limit');
    else expect(decode().filter((step) => step.kind === 'frame')).toHaveLength(1);
  });

  it('stores only the restored rectangle of a partial frame within the decoded budget', () => {
    const bytes = Uint8Array.from(Buffer.from(
      '47494638396102000100800100ff000000ff00' +
      '21f9040c010000002c00000000010001000002024401003b', 'hex'));
    const frames: number[][] = [];
    for (const step of decodePictureGif(bytes, { maxPixels: 2, maxDecodedBytes: 13 })) {
      if (step.kind === 'frame') frames.push(Array.from(step.pixels));
    }
    expect(frames).toEqual([
      [255, 0, 0, 255, 0, 255, 0, 255],
    ]);
  });
  it.each([
    { maxPixels: 3, maxDecodedBytes: 100, expected: 'pixel limit' },
    { maxPixels: 100, maxDecodedBytes: 15, expected: 'decoded byte limit' },
  ])('checks $expected before yielding a logical-screen allocation', (limits) => {
    const bytes = Uint8Array.from(Buffer.from('47494638396102000200800000000000ffffff2c00000000010001000002024401003b', 'hex'));
    expect(() => decodePictureGif(bytes, limits).next()).toThrow(limits.expected);
  });

  it('checks aggregate decoded frame bytes before composing another frame', () => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401002c00000000010001000002024401003b', 'hex'));
    const frames: number[][] = [];
    expect(() => {
      for (const step of decodePictureGif(bytes, { maxPixels: 1, maxDecodedBytes: 5 })) {
        if (step.kind === 'frame') frames.push(Array.from(step.pixels));
      }
    }).toThrow('decoded byte limit');
    expect(frames).toHaveLength(1);
  });

  it('preserves opaque logical-screen background through partial frames and disposal', () => {
    const bytes = Uint8Array.from(Buffer.from(
      '47494638396102000100800100ff000000ff00' +
      '21f90408010000002c0000000001000100000202440100' +
      '2c01000000010001000002024401003b', 'hex'));
    const frames: number[][] = [];
    for (const step of decodePictureGif(bytes, resolvedLimits)) {
      if (step.kind === 'frame') frames.push(Array.from(step.pixels));
    }
    expect(frames).toEqual([
      [255, 0, 0, 255, 0, 255, 0, 255],
      [0, 255, 0, 255, 255, 0, 0, 255],
    ]);
  });

  it('rejects a background index outside the declared global palette', () => {
    const bytes = Uint8Array.from(Buffer.from(
      '47494638396101000100800200ff000000ff002c00000000010001000002024401003b', 'hex'));
    expect(() => decodePictureGif(bytes, resolvedLimits).next()).toThrow('Unable to decode this GIF picture.');
  });

  it.each([
    [undefined, 1], [0, 0], [1, 2], [20, 21], [65534, 65535],
  ])('preserves GIF repetitions %s as WebP cycles %s', (repetitions, loop) => {
    expect(pictureAnimationTiming([0, 1, 2, 10, 65535], repetitions)).toEqual({ durations: [100, 100, 20, 100, 655350], loop });
  });
  it('rejects a finite GIF loop count that WebP cannot represent', () => {
    expect(() => pictureAnimationTiming([10], 65535)).toThrow(/loop/);
  });
  it('decodes transparent GIF frames without flattening and exposes bounded work checkpoints', () => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030102000021f904010a0000002c000000000100010000020244010021f90401140000002c00000000010001000002024c01003b', 'hex'));
    const decoder = decodePictureGif(bytes, resolvedLimits);
    const frames: Array<{ duration: number; pixels: number[] }> = [];
    let next = decoder.next();
    while (!next.done) {
      if (next.value.kind === 'frame') frames.push({ duration: next.value.duration, pixels: Array.from(next.value.pixels) });
      next = decoder.next();
    }
    expect(next.value).toEqual({ loop: 3, frameCount: 2, animated: true });
    expect(frames).toEqual([{ duration: 100, pixels: [0, 0, 0, 0] }, { duration: 200, pixels: [255, 255, 255, 255] }]);
  });
  it('composes partial transparent patches with restore-previous and restore-background disposal', () => {
    const bytes = readFileSync('test/fixtures/profile-disposal.gif');
    const samples: number[][][] = [];
    for (const step of decodePictureGif(bytes, resolvedLimits)) {
      if (step.kind === 'frame') samples.push([16, 48, 96, 192].map((x) => Array.from(step.pixels.subarray((64 * step.width + x) * 4, (64 * step.width + x) * 4 + 4))));
    }
    expect(samples).toEqual([
      [[255,0,0,255], [255,0,0,255], [255,0,0,255], [0,0,255,255]],
      [[0,255,0,255], [0,255,0,255], [255,0,0,255], [0,0,255,255]],
      [[255,255,255,255], [255,255,255,255], [255,0,0,255], [0,0,255,255]],
      [[255,255,0,255], [0,0,0,0], [255,0,0,255], [0,0,255,255]],
    ]);
  });

  it('packages independently encoded frames with complete duration and finite loop controls', () => {
    const frame = Uint8Array.from(Buffer.from('52494646220000005745425056503820160000003001009d012a0100010001402625a400037000fefb94', 'hex'));
    const result = encodePictureAnimation([{ bytes: frame, duration: 100 }, { bytes: frame, duration: 200 }], { width: 1, height: 1 }, 3, 5000);
    const data = Buffer.concat(result.map((part) => Buffer.from(part)));
    expect(data.toString('ascii', 0, 4)).toBe('RIFF');
    expect(data.readUInt32LE(4)).toBe(data.length - 8);
    expect(data.toString('ascii', 30, 34)).toBe('ANIM');
    expect(data.readUInt16LE(42)).toBe(3);
    expect(data.toString('ascii', 44, 48)).toBe('ANMF');
    expect(data.readUIntLE(64, 3)).toBe(100);
    expect(data[67]).toBe(2);
  });

  it('enforces the final canonical byte limit after removing real frame metadata', () => {
    const bytes = Uint8Array.from(readFileSync('test/fixtures/profile-frame-metadata.webp'));
    const frames = [{ bytes, duration: 100 }, { bytes, duration: 200 }];
    expect(bytes.byteLength * 2).toBe(2504);
    const result = Buffer.concat(encodePictureAnimation(frames, { width: 512, height: 512 }, 3, 1172).map((part) => Buffer.from(part)));
    expect(result.byteLength).toBe(1172);
    expect(result.includes(Buffer.from('ICCP'))).toBe(false);
    expect(result.includes(Buffer.from('EXIF'))).toBe(false);
    expect(() => encodePictureAnimation(frames, { width: 512, height: 512 }, 3, 1171)).toThrow(/byte limit/);
  });

  it('decodes growing LZW dictionaries and repeated-code entries', () => {
    const samples: number[][][] = [];
    for (const step of decodePictureGif(readFileSync('test/fixtures/profile-compressed.gif'), resolvedLimits)) {
      if (step.kind === 'frame') samples.push([16, 96].map((x) => Array.from(step.pixels.subarray((32 * step.width + x) * 4, (32 * step.width + x) * 4 + 4))));
    }
    expect(samples).toEqual([[[255,0,0,255],[0,0,255,255]], [[0,255,0,255],[255,255,0,255]], [[255,255,255,255],[255,0,255,255]]]);
  });

  it('uses local palettes and the GIF interlace pass order, keeping untagged one-frame sources static', () => {
    const steps = decodePictureGif(readFileSync('test/fixtures/profile-interlaced.gif'), resolvedLimits);
    let next = steps.next(); let pixels: number[] = [];
    while (!next.done) { if (next.value.kind === 'frame') pixels = Array.from(next.value.pixels); next = steps.next(); }
    expect(pixels).toEqual([255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255,0,0,255,255,0,0,255,255,255,255,255,255,255,255,255,255]);
    expect(next.value).toEqual({ loop: 1, frameCount: 1, animated: false });
  });
  it('preserves explicitly declared looping even for one-frame GIFs', () => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c00000000010001000002024401003b', 'hex'));
    const decoder = decodePictureGif(bytes, resolvedLimits); let step = decoder.next();
    while (!step.done) step = decoder.next();
    expect(step.value).toEqual({ loop: 0, frameCount: 1, animated: true });
  });
  it.each(['truncated', 'invalid index', 'missing clear', 'out of bounds', 'unsupported control'])('rejects %s GIF work rather than producing partial frames', (malformation) => {
    const bytes = Uint8Array.from(Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c00000000010001000002024401003b', 'hex'));
    if (malformation === 'truncated') bytes[bytes.length - 1] = 0;
    if (malformation === 'invalid index') bytes[39] = 0x5c;
    if (malformation === 'missing clear') bytes[39] = 0x40;
    if (malformation === 'out of bounds') bytes[28] = 1;
    if (malformation === 'unsupported control') bytes[22] = 2;
    expect(() => Array.from(decodePictureGif(bytes, resolvedLimits))).toThrow();
  });

});
