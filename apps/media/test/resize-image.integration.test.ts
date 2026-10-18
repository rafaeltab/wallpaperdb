import { ManagedRuntime } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sharpTransformerLayer } from '../src/adapters/assets/index.js';
import { ImageTransformer, type ResizeOptions } from '../src/capabilities/delivery/index.js';
import {
  orientationCases,
  orientationColors,
  orientationFixture,
  samplePixelGrid,
} from '@wallpaperdb/test-utils/fixtures';

async function transform(input: Buffer, options: ResizeOptions, format: 'jpeg' | 'png' | 'webp') {
  const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels: 268435456 }));
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
  describe.each(['jpeg', 'png', 'webp'] as const)('%s stored geometry inspection', (format) => {
    it.each(
      orientationCases
    )('inspects displayed orientation $orientation and releases its input', async ({
      orientation,
      grid,
    }) => {
      const input = await orientationFixture(format, orientation);
      const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels: 268435456 }));
      let closed = false;
      try {
        expect(
          await runtime.runPromise(
            ImageTransformer.use((t) =>
              t.inspect({
                close() {
                  closed = true;
                },
                async *[Symbol.asyncIterator]() {
                  yield input;
                },
              })
            )
          )
        ).toEqual({
          width: grid[0].length * 40,
          height: grid.length * 40,
          requiresOrientation: typeof orientation === 'number' && orientation >= 2,
        });
        expect(closed).toBe(true);
      } finally {
        await runtime.dispose();
      }
    });
  });
  it.each([
    { name: 'corrupt input', limit: 268435456, input: Buffer.from('invalid-image') },
    { name: 'input pixel limit', limit: 9599, input: undefined },
  ])('rejects $name during inspection and closes the source', async ({ input, limit }) => {
    const bytes = input ?? (await orientationFixture('png', 6));
    const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels: limit }));
    let closed = false;
    try {
      await expect(
        runtime.runPromise(
          ImageTransformer.use((t) =>
            t.inspect({
              close() {
                closed = true;
              },
              async *[Symbol.asyncIterator]() {
                yield bytes;
              },
            })
          )
        )
      ).rejects.toMatchObject({ _tag: 'DeliveryUnavailable', operation: 'inspect_image' });
      expect(closed).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
  it.each([
    'interruption',
    'deadline',
  ] as const)('shares native capacity and releases it after inspection %s', async (mode) => {
    const runtime = ManagedRuntime.make(
      sharpTransformerLayer({
        maxInputPixels: 268435456,
        maxConcurrent: 1,
        timeoutMs: mode === 'deadline' ? 2000 : 30000,
      })
    );
    const controller = new AbortController();
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    const pending = runtime.runPromise(
      ImageTransformer.use((t) =>
        t.inspect({
          close() {
            closed = true;
            release();
          },
          async *[Symbol.asyncIterator]() {
            entered();
            await blocked;
            yield new Uint8Array();
          },
        })
      ),
      { signal: controller.signal }
    );
    const settled = pending.then(
      () => 'unexpected success',
      () => 'failed'
    );
    try {
      await ready;
      let refusedClosed = false;
      await expect(
        runtime.runPromise(
          ImageTransformer.use((t) =>
            t.resize(
              {
                close() {
                  refusedClosed = true;
                },
                async *[Symbol.asyncIterator]() {},
              },
              { width: 20, fit: 'contain', mimeType: 'image/png' }
            )
          )
        )
      ).rejects.toMatchObject({ operation: 'resize_capacity' });
      expect(refusedClosed).toBe(true);
      if (mode === 'interruption') controller.abort();
      expect(await settled).toBe('failed');
      expect(closed).toBe(true);
      const input = await orientationFixture('png', 6);
      expect(
        await runtime.runPromise(
          ImageTransformer.use((t) =>
            t.inspect({
              close() {},
              async *[Symbol.asyncIterator]() {
                yield input;
              },
            })
          )
        )
      ).toMatchObject({ width: 80, height: 120 });
    } finally {
      controller.abort();
      release();
      await settled;
      await runtime.dispose();
    }
  });
  describe.each(['jpeg', 'png', 'webp'] as const)('%s orientation and privacy', (format) => {
    it.each(
      orientationCases
    )('resizes using displayed orientation $orientation and removes private metadata', async ({
      orientation,
      grid,
    }) => {
      const input = await orientationFixture(format, orientation);
      const original = Buffer.from(input);
      const source = await sharp(input).metadata();
      expect(source.orientation).toBe(orientation === 'absent' ? undefined : orientation);
      expect(source.exif?.includes(Buffer.from('Private camera'))).toBe(true);
      expect(source.exif?.includes(Buffer.from('Private serial'))).toBe(true);
      expect(source.exif?.includes(Buffer.from([0xff, 0xd8]))).toBe(true);
      const bytes = await transform(input, { width: 60, height: 60, fit: 'contain' }, format);
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({
        width: grid[0].length * 20,
        height: grid.length * 20,
        format,
      });
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      const pixels = await samplePixelGrid(bytes, grid[0].length, grid.length);
      for (const [row, colors] of grid.entries())
        for (const [column, color] of [...colors].entries()) {
          for (const [channel, expected] of orientationColors[color]!.entries()) {
            expect(Math.abs(pixels[row]![column]![channel]! - expected)).toBeLessThan(25);
          }
        }
      expect(input).toEqual(original);
    });
  });

  describe.each(
    orientationCases.filter(
      ({ orientation }) => typeof orientation === 'number' && orientation >= 5
    )
  )('swapped axes orientation $orientation', ({ orientation, grid }) => {
    it.each([
      {
        name: 'width only',
        options: { width: 40, fit: 'contain' as const },
        width: 40,
        height: 60,
      },
      {
        name: 'height only',
        options: { height: 60, fit: 'contain' as const },
        width: 40,
        height: 60,
      },
      {
        name: 'contain bounds',
        options: { width: 40, height: 80, fit: 'contain' as const },
        width: 40,
        height: 60,
      },
      {
        name: 'cover crop',
        options: { width: 40, height: 80, fit: 'cover' as const },
        width: 40,
        height: 80,
      },
      {
        name: 'fill stretch',
        options: { width: 40, height: 80, fit: 'fill' as const },
        width: 40,
        height: 80,
      },
      {
        name: 'contain without enlargement',
        options: { width: 200, height: 200, fit: 'contain' as const },
        width: 80,
        height: 120,
      },
      {
        name: 'cover without enlargement',
        options: { width: 160, height: 240, fit: 'cover' as const },
        width: 80,
        height: 120,
      },
      {
        name: 'fill enlargement',
        options: { width: 160, height: 240, fit: 'fill' as const },
        width: 160,
        height: 240,
      },
    ])('uses oriented geometry for $name', async ({ options, width, height }) => {
      const bytes = await transform(await orientationFixture('png', orientation), options, 'png');
      expect(await sharp(bytes).metadata()).toMatchObject({ width, height });
      // The cover request trims at most 14 horizontal pixels. Both column
      // centers remain in their known blocks regardless of entropy's crop edge.
      const pixels = await samplePixelGrid(bytes, 2, 3);
      for (const [row, colors] of grid.entries())
        for (const [column, color] of [...colors].entries()) {
          for (const [channel, expected] of orientationColors[color]!.entries()) {
            expect(Math.abs(pixels[row]![column]![channel]! - expected)).toBeLessThan(25);
          }
        }
    });
  });
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
      request: [1000, 1000],
      fit: 'contain' as const,
      output: [1000, 563],
    },
    {
      name: 'square contain',
      source: [1200, 1200],
      request: [1000, 1000],
      fit: 'contain' as const,
      output: [1000, 1000],
    },
    {
      name: 'landscape cover',
      source: [1920, 1080],
      request: [1000, 1000],
      fit: 'cover' as const,
      output: [1000, 1000],
    },
    {
      name: 'portrait cover',
      source: [1080, 1920],
      request: [800, 600],
      fit: 'cover' as const,
      output: [800, 600],
    },
    {
      name: 'landscape fill',
      source: [1920, 1080],
      request: [1000, 1000],
      fit: 'fill' as const,
      output: [1000, 1000],
    },
    {
      name: 'portrait fill',
      source: [1080, 1920],
      request: [1200, 800],
      fit: 'fill' as const,
      output: [1200, 800],
    },
  ])('encodes $name dimensions', async ({ source, request, fit, output }) => {
    const result = await resize(source[0], source[1], {
      width: request[0],
      height: request[1],
      fit,
    });
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
    { name: 'materialized rendition downscale', source: [1920, 1080], output: [1600, 900] },
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
