import { Blob as NativeBlob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

// jsdom's Blob lacks arrayBuffer(); use the native Blob API for real header bytes.
beforeEach(() => vi.stubGlobal('Blob', NativeBlob));
afterEach(() => vi.unstubAllGlobals());

it.each(['worker', 'fallback'])('rejects APNG before the %s decoder can flatten its animation', async (mode) => {
  // Generated from the existing small PNG with valid acTL/fcTL chunks and CRCs.
  const fixture = await readFile(new URL('../fixtures/profile-animated.png', import.meta.url));
  const decode = vi.fn(() => { throw new Error('Source reached the decoder.'); });
  const worker = vi.fn(function () { throw new Error('Source reached the worker.'); });
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('Worker', mode === 'worker' ? worker : undefined);
  vi.stubGlobal('OffscreenCanvas', mode === 'worker' ? vi.fn() : undefined);
  await expect(openPictureSource(new Blob([fixture], { type: 'image/png' }), new AbortController().signal)).rejects.toThrow('Animated PNG pictures are not supported. Choose a static picture.');
  expect(decode).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

it('validates detected source bytes before decoding a misleading declared format', async () => {
  await expect(openPictureSource(new Blob(['<svg/>'], { type: 'image/png' }), new AbortController().signal)).rejects.toThrow('Choose a valid JPEG, PNG, or WebP picture.');
});

it('rejects animated WebP instead of silently flattening it in the static editor', async () => {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
  bytes[20] = 2;
  await expect(openPictureSource(new Blob([bytes], { type: 'image/webp' }), new AbortController().signal)).rejects.toThrow('Animated WebP pictures are not supported.');
});

it('honors cancellation before decoded source work can begin', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(openPictureSource(new Blob([new Uint8Array([255, 216, 255])]), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it.each(['pq', 'hlg'])('rejects %s PNG16 color declarations before rasterizing the source', async (transfer) => {
  // Generated RGB16 PNGs with valid CRCs and standard PQ/HLG cICP declarations.
  const fixture = await readFile(new URL(`../fixtures/profile-${transfer}.png`, import.meta.url));
  const decode = vi.fn(() => { throw new Error('Source reached the decoder.'); });
  const worker = vi.fn(function () { throw new Error('Source reached the worker.'); });
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('Worker', worker);
  vi.stubGlobal('OffscreenCanvas', class {});
  await expect(openPictureSource(new Blob([fixture]), new AbortController().signal)).rejects.toThrow('color interpretation is not supported');
  expect(decode).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});
