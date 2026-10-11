import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePictureGif, pictureAnimationTiming, encodePictureAnimation } from '../../src/features/picture-editor';

describe('Picture animation', () => {
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
    const decoder = decodePictureGif(bytes);
    const frames: Array<{ duration: number; pixels: number[] }> = [];
    let next = decoder.next();
    while (!next.done) {
      if (next.value.kind === 'frame') frames.push({ duration: next.value.duration, pixels: Array.from(next.value.pixels) });
      next = decoder.next();
    }
    expect(next.value).toEqual({ loop: 3, frameCount: 2 });
    expect(frames).toEqual([{ duration: 100, pixels: [0, 0, 0, 0] }, { duration: 200, pixels: [255, 255, 255, 255] }]);
  });
  it('composes partial transparent patches with restore-previous and restore-background disposal', () => {
    const bytes = readFileSync('test/fixtures/profile-disposal.gif');
    const samples: number[][][] = [];
    for (const step of decodePictureGif(bytes)) {
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
    const result = encodePictureAnimation([{ bytes: frame, duration: 100 }, { bytes: frame, duration: 200 }], { width: 1, height: 1 }, 3);
    const data = Buffer.from(result);
    expect(data.toString('ascii', 0, 4)).toBe('RIFF');
    expect(data.readUInt32LE(4)).toBe(data.length - 8);
    expect(data.toString('ascii', 30, 34)).toBe('ANIM');
    expect(data.readUInt16LE(42)).toBe(3);
    expect(data.toString('ascii', 44, 48)).toBe('ANMF');
    expect(data.readUIntLE(64, 3)).toBe(100);
    expect(data[67]).toBe(2);
  });

});
