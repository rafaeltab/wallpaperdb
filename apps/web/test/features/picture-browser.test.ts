import { Blob as NativeBlob } from 'node:buffer';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

// jsdom's Blob lacks arrayBuffer(); use the native Blob API for real header bytes.
beforeAll(() => vi.stubGlobal('Blob', NativeBlob));
afterAll(() => vi.unstubAllGlobals());

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
