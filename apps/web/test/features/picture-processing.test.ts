import { Blob as NativeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialPictureCrop, type PictureEncodingPolicy } from '@/features/picture-editor';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

const policy: PictureEncodingPolicy = {
  output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
  maxOutputBytes: 4096,
  animation: { available: false },
  encoding: { staticQuality: 85, animationQuality: 85 },
};
let source: Blob;
let encoded: Blob;
const closed = vi.fn();
const draw = vi.fn();

beforeEach(async () => {
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('HTMLImageElement', class {});
  closed.mockReset(); draw.mockReset();
  source = new Blob([await readFile(new URL('../../../web-e2e/fixtures/profile-small.png', import.meta.url))]);
  // Real canonical pixels from the browser journey, with an encoder-added XMP chunk.
  const bytes = await readFile(new URL('../fixtures/profile-canonical.webp', import.meta.url));
  bytes[20] |= 4;
  const metadata = Buffer.from('PRIVATE_CAMERA');
  const chunk = Buffer.alloc(8 + metadata.length + metadata.length % 2);
  chunk.write('XMP '); chunk.writeUInt32LE(metadata.length, 4); chunk.set(metadata, 8);
  bytes.writeUInt32LE(bytes.length + chunk.length - 8, 4);
  encoded = new Blob([bytes, chunk], { type: 'image/webp' });
  vi.stubGlobal('createImageBitmap', async () => ({ width: 32, height: 48, close: closed }));
  // Controlled platform ports isolate adapter cancellation, output admission and metadata handling.
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: draw, imageSmoothingQuality: 'low' }),
      toBlob: (callback: (blob: Blob) => void, type: string) => callback(type === 'image/png' ? new Blob(['preview'], { type }) : encoded),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['png', 'gif'])('serializes %s fallback jobs until a canceled native encode settles', async (format) => {
  const file = format === 'gif'
    ? new Blob([Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex')])
    : source;
  const limits = { maxPixels: 20_000_000, maxDecodedBytes: 80_000_000 };
  const callbacks: Array<(blob: Blob) => void> = [];
  vi.stubGlobal('ImageData', class {});
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ putImageData() {}, clearRect() {}, drawImage() {} }),
    toBlob(callback: (blob: Blob) => void, type: string) {
      if (type === 'image/png') callback(new Blob(['preview'], { type }));
      else callbacks.push(callback);
    },
  }) });
  const firstSource = await openPictureSource(file, new AbortController().signal, limits);
  const secondSource = await openPictureSource(file, new AbortController().signal, limits);
  const requests: Promise<Blob>[] = [];
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const first = firstSource.process(initialPictureCrop(firstSource), policy, controller.signal);
    first.catch(() => {}); requests.push(first);
    await vi.runAllTimersAsync();
    expect(callbacks).toHaveLength(1);
    controller.abort();
    const queuedController = new AbortController();
    const queued = secondSource.process(initialPictureCrop(secondSource), policy, queuedController.signal);
    queued.catch(() => {}); requests.push(queued);
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    const second = secondSource.process(initialPictureCrop(secondSource), policy, new AbortController().signal);
    second.catch(() => {}); requests.push(second);
    await vi.runAllTimersAsync();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(encoded);
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(encoded);
    await vi.runAllTimersAsync();
    await expect(second).resolves.toMatchObject({ type: 'image/webp' });
  } finally {
    firstSource.dispose(); secondSource.dispose();
    for (const callback of callbacks.splice(0)) callback(encoded);
    await vi.runAllTimersAsync();
    await Promise.allSettled(requests);
    vi.useRealTimers();
  }
});

it('returns metadata-free WebP through the yielding fallback and releases decoded bitmaps', async () => {
  const picture = await openPictureSource(source, new AbortController().signal);
  expect(picture).toMatchObject({ width: 32, height: 48 });
  const result = await picture.process(initialPictureCrop(picture), policy, new AbortController().signal);
  expect(result.type).toBe('image/webp');
  const bytes = Buffer.from(await result.arrayBuffer());
  expect(bytes.includes(Buffer.from('PRIVATE_CAMERA'))).toBe(false);
  expect(bytes.includes(Buffer.from('XMP '))).toBe(false);
  expect(bytes[20] & 4).toBe(0);
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  expect(closed).toHaveBeenCalledTimes(2);
  picture.dispose();
});

it('rejects an encoded result exceeding the effective output byte limit', async () => {
  const picture = await openPictureSource(source, new AbortController().signal);
  await expect(picture.process(initialPictureCrop(picture), { ...policy, maxOutputBytes: 1 }, new AbortController().signal)).rejects.toThrow('Processed picture exceeds');
  expect(closed).toHaveBeenCalledTimes(2);
  picture.dispose();
});

it('reports unsupported browser WebP encoding instead of returning another format', async () => {
  encoded = new Blob(['jpeg'], { type: 'image/jpeg' });
  const picture = await openPictureSource(source, new AbortController().signal);
  await expect(picture.process(initialPictureCrop(picture), policy, new AbortController().signal)).rejects.toThrow('cannot encode WebP');
  expect(closed).toHaveBeenCalledTimes(2);
  picture.dispose();
});

it('cancels fallback drawing without returning partially processed bytes', async () => {
  const picture = await openPictureSource(source, new AbortController().signal);
  const controller = new AbortController();
  draw.mockImplementation(() => controller.abort());
  await expect(picture.process(initialPictureCrop(picture), policy, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(closed).toHaveBeenCalledTimes(2);
  picture.dispose();
});

it('disposes outstanding processing and refuses further work from an abandoned source', async () => {
  const picture = await openPictureSource(source, new AbortController().signal);
  const crop = initialPictureCrop(picture);
  const processing = picture.process(crop, policy, new AbortController().signal);
  picture.dispose();
  await expect(processing).rejects.toMatchObject({ name: 'AbortError' });
  await expect(picture.process(crop, policy, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('falls back for preview and processing when the worker module fails after construction', async () => {
  const terminated = vi.fn();
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('Worker', class {
    onerror: ((event: Event) => void) | null = null;
    postMessage() { queueMicrotask(() => this.onerror?.(new Event('error'))); }
    terminate() { terminated(); }
  });
  const picture = await openPictureSource(source, new AbortController().signal);
  const result = await picture.process(initialPictureCrop(picture), policy, new AbortController().signal);
  expect(result.type).toBe('image/webp');
  expect(terminated).toHaveBeenCalledTimes(2);
  expect(closed).toHaveBeenCalledTimes(2);
  picture.dispose();
});

it('retains explicit worker decode failures without retrying unsupported image data', async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('Worker', class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage() { queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: false, message: 'Invalid image data.' } }))); }
    terminate() {}
  });
  await expect(openPictureSource(source, new AbortController().signal)).rejects.toThrow('Invalid image data.');
  expect(closed).not.toHaveBeenCalled();
});
