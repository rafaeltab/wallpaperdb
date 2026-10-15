import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { initialPictureCrop, type PictureEncodingPolicy } from '../index';
import { staticPictureJob } from './static';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { source: { width: 32, height: 48 }, output: [32, 48] },
  { source: { width: 4096, height: 2048 }, output: [1024, 512] },
  { source: { width: 2048, height: 4096 }, output: [512, 1024] },
  { source: { width: 1, height: 4096 }, output: [1, 1024] },
  { source: { width: 4096, height: 1 }, output: [1024, 1] },
])('previews $source at $output and reports oriented source dimensions', async ({
  source,
  output,
}) => {
  const preview = new Blob(['preview'], { type: 'image/png' });
  const context = { imageSmoothingQuality: 'low' };
  const getContext = vi.fn(() => context);
  const encode = vi.fn((callback: BlobCallback) => callback(preview));
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext, toBlob: encode }),
  });
  const canvas = document.createElement('canvas');
  const draw = vi.fn();

  const result = await staticPictureJob(
    { action: 'preview', file: new Blob() },
    source,
    canvas,
    draw
  );

  expect([canvas.width, canvas.height]).toEqual(output);
  expect(getContext).toHaveBeenCalledWith('2d', { alpha: true, colorSpace: 'srgb' });
  expect(context.imageSmoothingQuality).toBe('high');
  expect(draw).toHaveBeenCalledWith(context, {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  });
  expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
  expect(result).toEqual({ ok: true, blob: preview, ...source });
});

it.each([
  'dom',
  'offscreen',
])('processes the selected crop with effective policy and strips metadata on %s canvas', async (mode) => {
  const pixels = await readFile(
    new URL('../../../../test/fixtures/profile-canonical.webp', import.meta.url)
  );
  pixels[20] |= 4;
  const metadata = Buffer.from('XMP \x04\x00\x00\x00TEST');
  pixels.writeUInt32LE(pixels.length + metadata.length - 8, 4);
  const encoded = new Blob([pixels, metadata], { type: 'image/webp' });
  const context = { imageSmoothingQuality: 'low' };
  const getContext = vi.fn(() => context);
  const encode = vi.fn(async () => encoded);
  const toBlob = vi.fn((callback: BlobCallback) => {
    void encode().then(callback);
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext, toBlob }) });
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width = 0;
      height = 0;
      getContext = getContext;
      convertToBlob = encode;
    }
  );
  const canvas = mode === 'dom' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
  const draw = vi.fn();
  const policy: PictureEncodingPolicy = {
    output: { width: 320, height: 192, mimeType: 'image/webp', colorSpace: 'srgb' },
    maxOutputBytes: 5242880,
    animation: { available: true },
    encoding: { staticQuality: 63, animationQuality: 20 },
  };
  const result = await staticPictureJob(
    {
      action: 'process',
      file: new Blob(),
      crop: { ...initialPictureCrop({ width: 48, height: 32 }), x: 7.5, y: 11.25, size: 20 },
      policy,
    },
    { width: 48, height: 32 },
    canvas,
    draw
  );

  expect([canvas.width, canvas.height]).toEqual([320, 192]);
  expect(getContext).toHaveBeenCalledWith('2d', { alpha: true, colorSpace: 'srgb' });
  expect(context.imageSmoothingQuality).toBe('high');
  expect(draw).toHaveBeenCalledWith(context, { x: 7.5, y: 11.25, width: 20, height: 20 });
  if (mode === 'dom') expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.63);
  else expect(encode).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.63 });
  expect(result).toMatchObject({ ok: true, width: 48, height: 32, blob: { type: 'image/webp' } });
  expect(Buffer.from(await result.blob.arrayBuffer()).includes(Buffer.from('TEST'))).toBe(false);
  expect(result.blob.size).toBe(pixels.length);
});
