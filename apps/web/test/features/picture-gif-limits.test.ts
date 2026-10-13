import { Blob as NativeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialPictureCrop, type PictureEncodingPolicy } from '@/features/picture-editor';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

const resolvedLimits = { maxPixels: 20_000_000, maxDecodedBytes: 80_000_000 };

beforeEach(() => vi.stubGlobal('Blob', NativeBlob));
afterEach(() => vi.unstubAllGlobals());

it('requires resolved GIF limits before copying source bytes or allocating a canvas', async () => {
  vi.stubGlobal('Worker', undefined);
  const allocate = vi.fn(() => { throw new Error('Allocated a GIF canvas.'); });
  vi.stubGlobal('document', { createElement: allocate });
  const copy = vi.fn();
  class Source extends Blob {
    arrayBuffer() { copy(); return super.arrayBuffer(); }
  }
  const bytes = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
  await expect(openPictureSource(new Source([bytes]), new AbortController().signal)).rejects.toThrow('resource limits');
  expect(copy).not.toHaveBeenCalled();
  expect(allocate).not.toHaveBeenCalled();
});

it('rejects GIF sources above 50 MiB before copying their compressed bytes', async () => {
  vi.stubGlobal('Worker', undefined);
  const allocate = vi.fn();
  vi.stubGlobal('document', { createElement: allocate });
  const copy = vi.fn(async () => { throw new Error('Copied oversized GIF.'); });
  class OversizedGif extends Blob {
    get size() { return 50 * 1024 * 1024 + 1; }
    arrayBuffer() { return copy(); }
  }
  const file = new OversizedGif(['GIF89a']);
  await expect(openPictureSource(file, new AbortController().signal, resolvedLimits))
    .rejects.toThrow('50 MiB');
  expect(copy).not.toHaveBeenCalled();
  expect(allocate).not.toHaveBeenCalled();
});

it('accepts a GIF source at 50 MiB before processing instead of applying the 5 MiB upload bound', async () => {
  vi.stubGlobal('Worker', undefined);
  const allocate = vi.fn(() => { throw new Error('Admitted source to canvas.'); });
  vi.stubGlobal('document', { createElement: allocate });
  const bytes = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
  const copy = vi.fn(async () => Uint8Array.from(bytes).buffer);
  class LargeGif extends Blob {
    get size() { return 50 * 1024 * 1024; }
    arrayBuffer() { return copy(); }
  }
  await expect(openPictureSource(new LargeGif([bytes]), new AbortController().signal, resolvedLimits))
    .rejects.toThrow('Admitted source to canvas.');
  expect(copy).toHaveBeenCalledOnce();
  expect(allocate).toHaveBeenCalledOnce();
});

it.each([false, true])('uses the quality of the final GIF classification, looping=%s', async (looping) => {
  const encoded = new Blob([await readFile(new URL('../fixtures/profile-canonical.webp', import.meta.url))], { type: 'image/webp' });
  const qualities: number[] = [];
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('ImageData', class {});
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ putImageData() {}, clearRect() {}, drawImage() {}, imageSmoothingQuality: 'low' }),
    toBlob(callback: (value: Blob) => void, type: string, quality: number) {
      if (type === 'image/webp') qualities.push(quality);
      callback(type === 'image/png' ? new Blob(['preview'], { type }) : encoded);
    },
  }) });
  const bytes = Buffer.concat([
    Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
    ...(looping ? [Buffer.from('21ff0b4e45545343415045322e300301000000', 'hex')] : []),
    Buffer.from('2c00000000010001000002024401003b', 'hex'),
  ]);
  const picture = await openPictureSource(new Blob([bytes]), new AbortController().signal, resolvedLimits);
  const policy: PictureEncodingPolicy = {
    output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
    maxOutputBytes: 5242880, animation: { available: true },
    encoding: { staticQuality: 91, animationQuality: 63 },
  };
  const result = await picture.process(initialPictureCrop(picture), policy, new AbortController().signal);
  expect(qualities.at(-1)).toBe(looping ? 0.63 : 0.91);
  expect(Buffer.from(await result.arrayBuffer()).includes(Buffer.from('ANIM'))).toBe(looping);
  picture.dispose();
});

it('rejects excessive GIF logical dimensions before the fallback creates a canvas', async () => {
  const allocate = vi.fn(() => { throw new Error('Reached canvas allocation.'); });
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('document', { createElement: allocate });
  const bytes = Buffer.from('47494638396102000200800000000000ffffff2c00000000010001000002024401003b', 'hex');
  await expect(openPictureSource(new Blob([bytes]), new AbortController().signal,
    { maxPixels: 3, maxDecodedBytes: 100 })).rejects.toThrow('pixel limit');
  expect(allocate).not.toHaveBeenCalled();
});

it('bounds output-frame work before the fallback encodes another frame', async () => {
  const encoded = new Blob([await readFile(new URL('../fixtures/profile-canonical.webp', import.meta.url))], { type: 'image/webp' });
  const encode = vi.fn();
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('ImageData', class {});
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ putImageData() {}, clearRect() {}, drawImage() {}, imageSmoothingQuality: 'low' }),
    toBlob(callback: (value: Blob) => void, type: string) {
      if (type === 'image/webp') encode();
      callback(type === 'image/png' ? new Blob(['preview'], { type }) : encoded);
    },
  }) });
  const bytes = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401002c00000000010001000002024401003b', 'hex');
  const picture = await openPictureSource(new Blob([bytes]), new AbortController().signal,
    { maxPixels: 1, maxDecodedBytes: 8 });
  const policy: PictureEncodingPolicy = {
    output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
    maxOutputBytes: 4096, animation: { available: true },
    encoding: { staticQuality: 85, animationQuality: 85 },
  };
  await expect(picture.process(initialPictureCrop(picture), policy, new AbortController().signal)).rejects.toThrow('decoded byte limit');
  expect(encode).toHaveBeenCalledTimes(1);
  picture.dispose();
});

it('passes the advertised GIF limits to worker preview and processing', async () => {
  const encoded = new Blob([await readFile(new URL('../fixtures/profile-canonical.webp', import.meta.url))], { type: 'image/webp' });
  const jobs: unknown[] = [];
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void;
    postMessage(job: { action: string }) {
      jobs.push(job);
      queueMicrotask(() => this.onmessage?.({ data: {
        ok: true, width: 1, height: 1,
        blob: job.action === 'preview' ? new Blob(['preview'], { type: 'image/png' }) : encoded,
      } }));
    }
    terminate() {}
  });
  const bytes = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
  const limits = { maxPixels: 9, maxDecodedBytes: 36 };
  const picture = await openPictureSource(new Blob([bytes]), new AbortController().signal, limits);
  const policy: PictureEncodingPolicy = {
    output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
    maxOutputBytes: 5242880, animation: { available: true },
    encoding: { staticQuality: 85, animationQuality: 85 },
  };
  await picture.process(initialPictureCrop(picture), policy, new AbortController().signal);
  expect(jobs).toEqual([
    expect.objectContaining({ action: 'preview', limits }),
    expect.objectContaining({ action: 'process', limits }),
  ]);
  picture.dispose();
});
