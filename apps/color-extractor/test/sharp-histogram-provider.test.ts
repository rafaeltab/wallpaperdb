import 'reflect-metadata';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { HsvEmbeddingStrategy } from '../src/services/hsv-embedding-strategy.js';
import type { ImageReader } from '../src/services/ports.js';
import { SharpHistogramProvider } from '../src/services/sharp-histogram-provider.js';

async function image(
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha?: number }
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

function providerFor(buffer: Buffer): SharpHistogramProvider {
  const reader: ImageReader = { read: vi.fn().mockResolvedValue(buffer) };
  return new SharpHistogramProvider(reader, new HsvEmbeddingStrategy());
}

function expectNormalized(histogram: number[]): void {
  expect(histogram).toHaveLength(64);
  expect(histogram.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
}

describe('SharpHistogramProvider', () => {
  it('produces a normalized pure-red histogram from an in-memory image', async () => {
    const histogram = await providerFor(await image(100, 100, { r: 255, g: 0, b: 0 })).extractHistogram(
      'unused',
      'unused'
    );

    expectNormalized(histogram);
    expect(histogram[3]).toBeCloseTo(1, 3);
    expect(histogram.filter((_, index) => index !== 3)).toEqual(
      expect.arrayContaining(histogram.filter((_, index) => index !== 3).map(() => 0))
    );
  });

  it('weights alpha and handles a large image', async () => {
    const histogram = await providerFor(
      await image(3840, 2160, { r: 0, g: 0, b: 255, alpha: 0.5 })
    ).extractHistogram('unused', 'unused');

    expectNormalized(histogram);
    expect(histogram[35]).toBeCloseTo(1, 3);
  });

  it('propagates image reader errors', async () => {
    const failure = new Error('read failed');
    const provider = new SharpHistogramProvider(
      { read: vi.fn().mockRejectedValue(failure) },
      new HsvEmbeddingStrategy()
    );

    await expect(provider.extractHistogram('bucket', 'key')).rejects.toBe(failure);
  });

  it('rejects invalid image bytes', async () => {
    await expect(
      providerFor(Buffer.from('not an image')).extractHistogram('unused', 'unused')
    ).rejects.toThrow();
  });

  it('clamps resize dimensions for an extremely tall image', async () => {
    const histogram = await providerFor(
      await image(1, 50000, { r: 255, g: 0, b: 0 })
    ).extractHistogram('unused', 'unused');

    expectNormalized(histogram);
    expect(histogram[3]).toBeCloseTo(1, 3);
  });
});
