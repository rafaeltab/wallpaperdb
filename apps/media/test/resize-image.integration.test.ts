import { ManagedRuntime } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sharpTransformerLayer } from '../src/adapters/assets/index.js';
import { ImageTransformer, type ResizeOptions } from '../src/capabilities/delivery/index.js';

async function resize(
  width: number,
  height: number,
  options: ResizeOptions,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
  maxInputPixels = 268435456
) {
  // Size-sensitive landscape, portrait, ultrawide, square, large and 8K fixtures stay unchanged.
  const input = await sharp({
    create: {
      width,
      height,
      channels: format === 'png' ? 4 : 3,
      background: { r: 100, g: 150, b: 200, alpha: 0.5 },
    },
  })
    .toFormat(format)
    .toBuffer();
  const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels }));
  try {
    const body = await runtime.runPromise(
      ImageTransformer.use((t) =>
        t.resize(
          {
            close() {},
            async *[Symbol.asyncIterator]() {
              yield input;
            },
          },
          { ...options, mimeType: `image/${format}` }
        )
      )
    );
    const chunks = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    await runtime.dispose();
  }
}

describe('native image resize contract', () => {
  it.each([
    {
      name: 'landscape width',
      source: [3840, 2160],
      options: { width: 1920 },
      output: [1920, 1080],
    },
    { name: 'portrait width', source: [1080, 1920], options: { width: 540 }, output: [540, 960] },
    {
      name: 'landscape height',
      source: [3840, 2160],
      options: { height: 1080 },
      output: [1920, 1080],
    },
    { name: 'portrait height', source: [1080, 1920], options: { height: 960 }, output: [540, 960] },
  ])('preserves aspect ratio for $name', async ({ source, options, output }) => {
    const result = await resize(source[0], source[1], { ...options, fit: 'contain' });
    expect(await sharp(result).metadata()).toMatchObject({
      width: output[0],
      height: output[1],
      format: 'jpeg',
    });
  });

  it.each([
    {
      name: 'landscape contain',
      source: [1600, 900],
      fit: 'contain' as const,
      output: [1000, 563],
    },
    { name: 'square contain', source: [1200, 1200], fit: 'contain' as const, output: [1000, 1000] },
    { name: 'landscape cover', source: [1920, 1080], fit: 'cover' as const, output: [1000, 1000] },
    { name: 'portrait cover', source: [1080, 1920], fit: 'cover' as const, output: [1000, 1000] },
    { name: 'landscape fill', source: [1600, 900], fit: 'fill' as const, output: [1000, 1000] },
    { name: 'portrait fill', source: [900, 1600], fit: 'fill' as const, output: [1000, 1000] },
  ])('encodes $name dimensions', async ({ source, fit, output }) => {
    const result = await resize(source[0], source[1], { width: 1000, height: 1000, fit });
    expect(await sharp(result).metadata()).toMatchObject({
      width: output[0],
      height: output[1],
      format: 'jpeg',
    });
  });

  it.each([
    {
      name: 'contain box',
      source: [1920, 1080],
      options: { width: 3840, height: 2160, fit: 'contain' as const },
      output: [1920, 1080],
    },
    {
      name: 'contain width',
      source: [1280, 720],
      options: { width: 1920, fit: 'contain' as const },
      output: [1280, 720],
    },
    {
      name: 'cover box',
      source: [1920, 1080],
      options: { width: 3840, height: 2160, fit: 'cover' as const },
      output: [1920, 1080],
    },
    {
      name: 'fill box',
      source: [1920, 1080],
      options: { width: 3840, height: 2160, fit: 'fill' as const },
      output: [3840, 2160],
    },
  ])('enforces enlargement policy for $name', async ({ source, options, output }) => {
    const result = await resize(source[0], source[1], options);
    expect(await sharp(result).metadata()).toMatchObject({
      width: output[0],
      height: output[1],
      format: 'jpeg',
    });
  });

  it.each([
    { name: '8K', source: [7680, 4320], output: [1920, 1080] },
    { name: 'above all materialized renditions', source: [3840, 2160], output: [2560, 1440] },
    { name: 'small', source: [320, 180], output: [160, 90] },
    { name: 'ultrawide', source: [3440, 1440], output: [1720, 720] },
    { name: 'portrait', source: [1080, 1920], output: [540, 960] },
    { name: 'square', source: [2048, 2048], output: [1024, 1024] },
  ])('handles the $name fixture', async ({ source, output }) => {
    const result = await resize(source[0], source[1], {
      width: output[0],
      height: output[1],
      fit: 'contain',
    });
    expect(await sharp(result).metadata()).toMatchObject({
      width: output[0],
      height: output[1],
      format: 'jpeg',
    });
  });
  it.each(['png', 'webp'] as const)('preserves %s encoding and dimensions', async (format) => {
    const result = await resize(1920, 1080, { width: 960, fit: 'contain' }, format);
    expect(await sharp(result).metadata()).toMatchObject({ width: 960, height: 540, format });
    if (format === 'png') {
      // The old fixture had three channels despite its transparency title. Exercise real alpha now.
      const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      expect(data[3]).toBe(128);
    }
  });
  it('rejects an input above the configured pixel limit', async () => {
    await expect(resize(320, 180, { width: 160, fit: 'contain' }, 'jpeg', 57599)).rejects.toThrow(
      'Image encoding failed'
    );
  });
});
