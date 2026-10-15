import { afterEach, expect, it, vi } from 'vitest';
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
