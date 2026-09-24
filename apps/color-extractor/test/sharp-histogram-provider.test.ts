import { Effect, Result } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { histogramFromImage } from '../src/adapters/image/index.js';

async function image(
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha?: number }
) {
  return sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer();
}

function expectNormalized(histogram: readonly number[]): void {
  expect(histogram).toHaveLength(64);
  expect(histogram.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
}

describe('Sharp image histogram adapter', () => {
  it.each([
    'png',
    'jpeg',
    'webp',
  ] as const)('decodes %s into normalized HSV bins', async (format) => {
    const bytes = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .toFormat(format, { lossless: true })
      .toBuffer();
    const histogram = await Effect.runPromise(histogramFromImage(bytes));
    expectNormalized(histogram);
    expect(histogram[3]).toBeCloseTo(1, 3);
    histogram.forEach((value, index) => {
      if (index !== 3) expect(value).toBe(0);
    });
  });

  it('preserves partial alpha weighting', async () => {
    // Already 10,000 pixels: decoding keeps these equally sized color regions
    // at their original dimensions, so resizing cannot blur their boundary.
    const pixels = Buffer.alloc(100 * 100 * 4);
    for (let pixel = 0; pixel < 100 * 100; pixel++) {
      const red = pixel < 5000;
      pixels.set(red ? [255, 0, 0, 255] : [0, 0, 255, 128], pixel * 4);
    }
    const bytes = await sharp(pixels, { raw: { width: 100, height: 100, channels: 4 } })
      .png()
      .toBuffer();
    const histogram = await Effect.runPromise(histogramFromImage(bytes));
    expectNormalized(histogram);
    expect(histogram[3]).toBeCloseTo(255 / (255 + 128), 5);
    expect(histogram[35]).toBeCloseTo(128 / (255 + 128), 5);
    histogram.forEach((value, index) => {
      if (index !== 3 && index !== 35) expect(value).toBe(0);
    });
  });

  it('keeps transparent images as zero bins', async () => {
    const histogram = await Effect.runPromise(
      histogramFromImage(await image(2, 2, { r: 255, g: 0, b: 0, alpha: 0 }))
    );
    expect(histogram).toEqual(Array(64).fill(0));
  });

  it.each([
    Buffer.from('not an image'),
    Buffer.alloc(0),
  ])('translates invalid image bytes into a technical failure', async (bytes) => {
    const result = await Effect.runPromise(Effect.result(histogramFromImage(bytes)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('ExtractionUnavailable');
      expect(result.failure.operation).toBe('decode-image');
      expect(result.failure.cause).toBeInstanceOf(Error);
    }
  });

  it.each([
    [1, 50000],
    [50000, 1],
  ])('clamps resize dimensions for %ix%i images', async (width, height) => {
    const histogram = await Effect.runPromise(
      histogramFromImage(await image(width, height, { r: 255, g: 0, b: 0 }))
    );
    expectNormalized(histogram);
    expect(histogram[3]).toBeCloseTo(1, 3);
  });
});
